// [INPUT]: Authenticated board commands, local store and EventKit DTO transport.
// [OUTPUT]: Independent board/sync lifecycle, durable edits and conflict recovery.
// [POS]: Local task service; no dependency on Codex sessions or model control.
// [PROTOCOL]: Keep tasks/AGENTS.md in sync when changing the contract.
mod bridge;
pub mod model;
pub mod native;
#[cfg(test)]
mod tests;
pub mod window;
use crate::config::{Paths, write_private};
use anyhow::{Context, Result, bail, ensure};
use model::*;
use serde_json::{Value, json};
use std::{
    process::Child,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::{Mutex, Notify};

pub struct Service {
    pub inner: Mutex<Inner>,
    paths: Paths,
    desired: AtomicBool,
    wake: Notify,
}
pub struct Inner {
    pub store: Store,
    error: Option<String>,
    pub status: String,
    pub window: Option<Child>,
    pub lease: String,
    pub reveal: u64,
}
impl Service {
    pub fn load(paths: &Paths) -> Arc<Self> {
        let loaded = match std::fs::read(paths.root.join("tasks.json")) {
            Ok(bytes) => serde_json::from_slice::<Store>(&bytes)
                .context("任务文件损坏，已停止写入以保留原数据")
                .and_then(|s| {
                    ensure!(s.schema == 1, "任务数据版本不受支持");
                    Ok(s)
                }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
            Err(e) => Err(e.into()),
        };
        let (store, error) = match loaded {
            Ok(s) => (s, None),
            Err(e) => (Store::default(), Some(e.to_string())),
        };
        Arc::new(Self {
            desired: AtomicBool::new(store.sync_enabled),
            paths: paths.clone(),
            wake: Notify::new(),
            inner: Mutex::new(Inner {
                store,
                error,
                status: "尚未同步".into(),
                window: None,
                lease: String::new(),
                reveal: 0,
            }),
        })
    }
    fn save(&self, inner: &mut Inner, mut next: Store) -> Result<()> {
        ensure!(
            inner.error.is_none(),
            "{}",
            inner.error.as_deref().unwrap_or("")
        );
        next.revision = inner.store.revision + 1;
        write_private(
            &self.paths.root.join("tasks.json"),
            &serde_json::to_vec_pretty(&next)?,
        )?;
        inner.store = next;
        Ok(())
    }
    pub async fn board_enabled(&self) -> bool {
        self.inner.lock().await.store.board_enabled
    }
    pub async fn state(&self) -> Value {
        let inner = self.inner.lock().await;
        json!({"store":inner.store,"status":inner.status,"error":inner.error})
    }
    pub async fn view_command(&self, command: Value) -> Result<Value> {
        ensure!(
            [
                "create",
                "update",
                "archive",
                "delete",
                "resolve",
                "restore",
                "keepLocal",
                "reorder",
                "sync",
                "uncertain"
            ]
            .contains(&command["op"].as_str().unwrap_or("")),
            "此入口仅支持任务操作；授权及同步设置请使用设置页"
        );
        self.command(command).await
    }
    pub async fn command(&self, command: Value) -> Result<Value> {
        let op = command["op"].as_str().context("缺少操作")?;
        // Stop the next native write before waiting for an in-flight operation.
        if op == "modules" && command["syncEnabled"] == false {
            self.desired.store(false, Ordering::SeqCst);
        }
        if op == "sync" {
            self.wake.notify_one();
            return Ok(json!({"ok":true}));
        }
        let mut inner = self.inner.lock().await;
        ensure!(
            inner.error.is_none(),
            "{}",
            inner.error.as_deref().unwrap_or("")
        );
        if op == "remindersStatus" {
            return bridge::request(&self.paths, json!({"op":"status"})).await;
        }
        if op == "createLists" {
            ensure!(
                command["iCloudConfirmed"] == true,
                "请确认目标为 iCloud 账户"
            );
            ensure!(!inner.store.sync_enabled, "请先暂停同步");
            return bridge::request(
                &self.paths,
                json!({"op":"createLists","source":command["source"]}),
            )
            .await;
        }
        if ["authorize", "calendars"].contains(&op) {
            return bridge::request(&self.paths, json!({"op":op})).await;
        }
        if op == "open" {
            ensure!(inner.store.board_enabled, "请先开启任务看板");
            if let Some(child) = inner.window.as_mut() {
                if child.try_wait()?.is_none() {
                    inner.reveal += 1;
                    return Ok(json!({"ok":true}));
                }
                inner.window = None;
            }
            inner.lease = uuid::Uuid::new_v4().to_string();
            inner.window = Some(
                std::process::Command::new(std::env::current_exe()?)
                    .arg("--data-dir")
                    .arg(&self.paths.root)
                    .args(["board-window", "--lease", &inner.lease])
                    .spawn()?,
            );
            return Ok(json!({"ok":true}));
        }
        if op == "windowSize" {
            let size: [u32; 2] = serde_json::from_value(command["size"].clone())?;
            ensure!(
                size[0] >= 640 && size[1] >= 420 && size[0] <= 16384 && size[1] <= 16384,
                "窗口尺寸无效"
            );
            let mut next = inner.store.clone();
            next.window_size = size;
            write_private(
                &self.paths.root.join("tasks.json"),
                &serde_json::to_vec_pretty(&next)?,
            )?;
            inner.store = next;
            return Ok(json!({"ok":true}));
        }
        if op == "window" {
            ensure!(
                command["lease"].as_str() == Some(&inner.lease),
                "看板窗口已失效"
            );
            return Ok(
                json!({"enabled":inner.store.board_enabled,"reveal":inner.reveal,"size":inner.store.window_size}),
            );
        }
        if command["revision"].as_u64() != Some(inner.store.revision) {
            self.desired
                .store(inner.store.sync_enabled, Ordering::SeqCst);
            self.wake.notify_one();
            bail!("任务已在别处更新，请刷新后再试；当前编辑未丢弃");
        }
        let mut next = inner.store.clone();
        match op {
            "modules" => {
                if let Some(enabled) = command["boardEnabled"].as_bool() {
                    next.board_enabled = enabled;
                }
                if let Some(enabled) = command["syncEnabled"].as_bool() {
                    if enabled {
                        let result =
                            bridge::request(&self.paths, json!({"op":"calendars"})).await?;
                        next.bindings
                            .validate(&serde_json::from_value::<Vec<Calendar>>(
                                result["calendars"].clone(),
                            )?)?;
                    }
                    next.sync_enabled = enabled;
                }
            }
            "bindings" | "repairBindings" => {
                ensure!(!next.sync_enabled, "请先暂停同步再设置列表");
                ensure!(
                    next.inflight
                        .as_ref()
                        .is_none_or(|i| op == "repairBindings" && i.action != "create"),
                    "请先核对此前未确认的创建操作"
                );
                ensure!(
                    op == "repairBindings" || !next.tasks.iter().any(|t| t.remote.is_some()),
                    "已有同步关联时不能替换列表，以免重复导入或误移任务"
                );
                let bindings: Bindings = serde_json::from_value(command["bindings"].clone())?;
                let calendars = bridge::request(&self.paths, json!({"op":"calendars"})).await?;
                let calendars =
                    serde_json::from_value::<Vec<Calendar>>(calendars["calendars"].clone())?;
                if op == "repairBindings" {
                    ensure!(
                        command["confirmRepair"] == true,
                        "请确认修复列表后重新核对原任务"
                    );
                    next.bindings.validate_repair(&bindings, &calendars)?;
                    let old_source = next.binding_source.as_deref().or_else(|| {
                        calendars
                            .iter()
                            .find(|c| next.bindings.ids().contains(&c.id.as_str()))
                            .map(|c| c.source.as_str())
                    });
                    let new_source = calendars
                        .iter()
                        .find(|c| c.id == bindings.todo)
                        .map(|c| c.source.as_str());
                    ensure!(
                        old_source.is_some() && old_source == new_source,
                        "修复必须使用原账户；无法确认原账户时请先恢复原列表"
                    );
                } else {
                    bindings.validate(&calendars)?;
                }
                ensure!(
                    command["iCloudConfirmed"] == true,
                    "请确认所选列表来自同一 iCloud 账户"
                );
                next.binding_source = calendars
                    .iter()
                    .find(|c| c.id == bindings.todo)
                    .map(|c| c.source.clone());
                next.bindings = bindings;
            }
            "create" => {
                ensure!(next.board_enabled, "看板已停用");
                let fields: Fields = serde_json::from_value(command["fields"].clone())?;
                fields.validate()?;
                next.tasks.push(Task {
                    id: uuid::Uuid::new_v4().to_string(),
                    fields,
                    archived: false,
                    delete_requested: false,
                    remote: None,
                    remote_missing: false,
                    conflict: None,
                });
            }
            "reorder" => {
                ensure!(next.board_enabled, "看板已停用");
                let ids: Vec<String> = serde_json::from_value(command["ids"].clone())?;
                ensure!(
                    ids.len() == next.tasks.len()
                        && ids.iter().collect::<std::collections::HashSet<_>>().len() == ids.len(),
                    "排序列表无效"
                );
                let mut tasks = Vec::new();
                for id in ids {
                    tasks.push(
                        next.tasks
                            .iter()
                            .find(|t| t.id == id)
                            .context("卡片已移除")?
                            .clone(),
                    );
                }
                next.tasks = tasks;
            }
            "update" | "archive" | "delete" | "resolve" | "restore" | "keepLocal" => {
                ensure!(next.board_enabled, "看板已停用");
                let id = command["id"].as_str().context("缺少任务 ID")?;
                ensure!(
                    next.inflight.as_ref().is_none_or(|i| i.task_id != id),
                    "此任务的远端操作尚待确认，请先同步核对"
                );
                let task = next
                    .tasks
                    .iter_mut()
                    .find(|t| t.id == id)
                    .context("任务不存在")?;
                if let Some(expected) = command.get("expectedTask") {
                    ensure!(
                        expected == &serde_json::to_value(&task)?,
                        "此任务已更新，当前草稿已保留；请核对最新任务内容后再编辑"
                    );
                }
                match op {
                    "update" => {
                        ensure!(
                            !task.remote.as_ref().is_some_and(|r| r.recurring),
                            "重复提醒请在 Apple 提醒事项中编辑"
                        );
                        ensure!(
                            task.conflict.is_none()
                                && !task.remote_missing
                                && !task.delete_requested,
                            "请先处理任务冲突或恢复记录"
                        );
                        let fields: Fields = serde_json::from_value(command["fields"].clone())?;
                        fields.validate()?;
                        task.fields = fields;
                    }
                    "archive" => {
                        task.archived = command["archived"].as_bool().context("缺少归档状态")?;
                    }
                    "delete" => {
                        ensure!(command["confirmBoth"] == true, "请确认永久删除两端任务");
                        ensure!(
                            task.conflict.is_none()
                                && !task.remote_missing
                                && !task.remote.as_ref().is_some_and(|r| r.recurring),
                            "请先处理冲突；重复或身份不明的提醒不允许删除"
                        );
                        task.delete_requested = true;
                        if task.remote.is_none() {
                            next.tasks.retain(|t| t.id != id);
                        }
                    }
                    "resolve" => {
                        let conflict = task.conflict.take().context("当前任务没有冲突")?;
                        match command["choice"].as_str() {
                            Some("remote") => {
                                let mut local = serde_json::to_value(&task.fields)?;
                                let remote = serde_json::to_value(&conflict.remote.fields)?;
                                for field in &conflict.fields {
                                    if field != "delete" {
                                        local[field] = remote[field].clone();
                                    }
                                }
                                task.fields = serde_json::from_value(local)?;
                                task.delete_requested = false;
                            }
                            Some("local") => {
                                ensure!(
                                    !task.delete_requested,
                                    "删除冲突需先保留远端，再重新确认删除"
                                );
                            }
                            _ => bail!("请选择保留本地或 Apple 版本"),
                        }
                        task.remote = Some(conflict.remote);
                    }
                    "restore" | "keepLocal" => {
                        ensure!(task.remote_missing, "此任务不需要恢复");
                        ensure!(
                            command["confirmNew"] == true,
                            "请确认原任务可能已移动，重新同步会创建一条新提醒"
                        );
                        task.remote = None;
                        task.remote_missing = false;
                        task.delete_requested = false;
                        task.conflict = None;
                        task.archived = op == "keepLocal";
                    }
                    _ => unreachable!(),
                }
                if op == "update"
                    && let Some(before) = command["before"].as_str()
                {
                    ensure!(
                        before != id && next.tasks.iter().any(|t| t.id == before),
                        "排序目标已失效"
                    );
                    let index = next.tasks.iter().position(|t| t.id == id).unwrap();
                    let task = next.tasks.remove(index);
                    let index = next.tasks.iter().position(|t| t.id == before).unwrap();
                    next.tasks.insert(index, task);
                }
            }
            "uncertain" => {
                ensure!(
                    command["confirmChecked"] == true,
                    "请先在 Apple 提醒事项中核实此前操作结果"
                );
                let intent = next.inflight.take().context("没有待确认操作")?;
                // Explicit abandonment keeps a recovery record; never silently retries a create.
                let task = next
                    .tasks
                    .iter_mut()
                    .find(|t| t.id == intent.task_id)
                    .context("任务不存在")?;
                ensure!(intent.action == "create", "此操作需要重新同步核对");
                task.archived = true;
            }
            _ => bail!("未知任务操作"),
        }
        if let Err(error) = self.save(&mut inner, next) {
            self.desired
                .store(inner.store.sync_enabled, Ordering::SeqCst);
            self.wake.notify_one();
            return Err(error);
        }
        self.desired
            .store(inner.store.sync_enabled, Ordering::SeqCst);
        if !inner.store.board_enabled {
            inner.lease.clear();
        }
        if !inner.store.sync_enabled {
            bridge::stop(&self.paths);
            inner.status = "同步已暂停；本地修改已保存".into();
        }
        self.wake.notify_one();
        Ok(json!({"store":inner.store,"status":inner.status}))
    }
    pub fn start(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let service = self.clone();
        tokio::spawn(async move {
            loop {
                if service.desired.load(Ordering::SeqCst) {
                    let mut inner = service.inner.lock().await;
                    if inner.store.sync_enabled
                        && let Err(error) = service.sync(&mut inner).await
                    {
                        inner.status = error.to_string();
                    }
                }
                if service.desired.load(Ordering::SeqCst) {
                    tokio::select! {_=service.wake.notified()=>{},_=tokio::time::sleep(std::time::Duration::from_secs(15))=>{}}
                } else {
                    service.wake.notified().await;
                }
            }
        })
    }
    async fn sync(&self, inner: &mut Inner) -> Result<()> {
        inner.status = "正在核对提醒事项…".into();
        let snapshot: Snapshot = serde_json::from_value(
            bridge::request(
                &self.paths,
                json!({"op":"snapshot","bindings":inner.store.bindings}),
            )
            .await?,
        )?;
        inner.store.bindings.validate(&snapshot.calendars)?;
        let mut next = inner.store.clone();
        recover_inflight(&mut next, &snapshot);
        reconcile(&mut next, &snapshot);
        if serde_json::to_value(&next)? != serde_json::to_value(&inner.store)? {
            self.save(inner, next)?;
        }
        if inner.store.inflight.is_some() {
            bail!("有创建结果尚未确认：请先核对 Apple 提醒事项，避免重复创建");
        }
        let ids: Vec<_> = inner.store.tasks.iter().map(|t| t.id.clone()).collect();
        for id in ids {
            if !self.desired.load(Ordering::SeqCst) {
                break;
            }
            let Some(task) = inner.store.tasks.iter().find(|t| t.id == id).cloned() else {
                continue;
            };
            if task.remote_missing
                || task.conflict.is_some()
                || task.remote.as_ref().is_some_and(|r| r.recurring)
            {
                continue;
            }
            if task.remote.is_none() && task.archived {
                continue;
            }
            if task
                .remote
                .as_ref()
                .is_some_and(|r| r.fields == task.fields)
                && !task.delete_requested
            {
                continue;
            }
            let intent = Intent {
                task_id: id.clone(),
                action: if task.delete_requested {
                    "delete"
                } else if task.remote.is_none() {
                    "create"
                } else {
                    "update"
                }
                .into(),
                expected: task.remote.clone(),
                desired: task.fields.clone(),
            };
            let mut next = inner.store.clone();
            next.inflight = Some(intent.clone());
            self.save(inner, next)?;
            let response = bridge::request(
                &self.paths,
                json!({"op":"write","bindings":inner.store.bindings,"intent":intent}),
            )
            .await?;
            let mut next = inner.store.clone();
            next.inflight = None;
            if response["deleted"] == true {
                next.tasks.retain(|t| t.id != id);
            } else {
                let remote: Remote = serde_json::from_value(response["remote"].clone())?;
                let task = next.tasks.iter_mut().find(|t| t.id == id).unwrap();
                task.fields = remote.fields.clone();
                task.remote = Some(remote);
            }
            self.save(inner, next)?;
        }
        let conflicts = inner
            .store
            .tasks
            .iter()
            .filter(|t| t.conflict.is_some() || t.remote_missing)
            .count();
        inner.status = if conflicts > 0 {
            format!("已核对；{conflicts} 项需要处理")
        } else {
            "已与 Apple 提醒事项核对".into()
        };
        Ok(())
    }
    pub async fn window_open(&self) -> bool {
        self.inner
            .lock()
            .await
            .window
            .as_mut()
            .is_some_and(|child| child.try_wait().ok().flatten().is_none())
    }

    pub async fn close_window(&self) {
        let mut inner = self.inner.lock().await;
        inner.lease.clear();
        if let Some(mut child) = inner.window.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub async fn stop(&self) {
        self.desired.store(false, Ordering::SeqCst);
        bridge::stop(&self.paths);
        let mut inner = self.inner.lock().await;
        inner.lease.clear();
        if let Some(mut child) = inner.window.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
