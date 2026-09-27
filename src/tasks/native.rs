// [INPUT]: Private bridge requests, EventKit and the native helper App identity.
// [OUTPUT]: Authorized list snapshots and preflight-checked reminder mutations.
// [POS]: All native objects stay inside this helper process; only DTOs cross IPC.
// [PROTOCOL]: Keep tasks/AGENTS.md in sync when changing the contract.
use super::model::*;
use crate::{
    config::{Paths, write_private},
    lifecycle::Runtime,
};
use anyhow::{Context, Result, bail, ensure};
use block2::RcBlock;
use objc2::{MainThreadMarker, rc::autoreleasepool};
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_event_kit::{EKAuthorizationStatus, EKCalendar, EKEntityType, EKEventStore, EKReminder};
use objc2_foundation::{
    NSArray, NSCalendar, NSCalendarIdentifierGregorian, NSDate, NSDateComponents, NSError,
    NSRunLoop, NSString, NSTimeZone, NSURL,
};
use serde_json::{Value, json};
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};

fn wait<T>(rx: mpsc::Receiver<T>) -> Result<T> {
    let until = Instant::now() + Duration::from_secs(120);
    loop {
        if let Ok(value) = rx.try_recv() {
            return Ok(value);
        }
        ensure!(Instant::now() < until, "提醒事项请求超时；已保留待确认操作");
        NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.05));
    }
}
fn authorized() -> bool {
    unsafe {
        EKEventStore::authorizationStatusForEntityType(EKEntityType::Reminder)
            == EKAuthorizationStatus::FullAccess
    }
}
fn calendars(store: &EKEventStore) -> Vec<Calendar> {
    unsafe {
        store
            .calendarsForEntityType(EKEntityType::Reminder)
            .iter()
            .filter_map(|c| {
                let source = c.source()?;
                Some(Calendar {
                    id: c.calendarIdentifier().to_string(),
                    title: c.title().to_string(),
                    source: source.sourceIdentifier().to_string(),
                    source_title: source.title().to_string(),
                    writable: c.allowsContentModifications(),
                })
            })
            .collect()
    }
}
fn remote(reminder: &EKReminder, bindings: &Bindings) -> Result<Remote> {
    unsafe {
        let calendar = reminder
            .calendar()
            .context("提醒事项没有列表")?
            .calendarIdentifier()
            .to_string();
        let column = if calendar == bindings.todo {
            "todo"
        } else if calendar == bindings.doing {
            "doing"
        } else if calendar == bindings.waiting {
            "waiting"
        } else {
            bail!("提醒事项已移到同步范围外")
        };
        let due = reminder.dueDateComponents().map(|d| Due {
            year: d.year() as i32,
            month: d.month() as u32,
            day: d.day() as u32,
            hour: (d.hour() != isize::MAX).then(|| d.hour() as u32),
            minute: (d.minute() != isize::MAX).then(|| d.minute() as u32),
            time_zone: d.timeZone().map(|z| z.name().to_string()),
        });
        let marker = reminder
            .URL()
            .and_then(|url| url.absoluteString())
            .map(|s| s.to_string())
            .filter(|s| s.starts_with("codexbuddy://task/"));
        Ok(Remote {
            id: reminder.calendarItemIdentifier().to_string(),
            external_id: reminder
                .calendarItemExternalIdentifier()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty()),
            marker,
            fields: Fields {
                title: reminder.title().to_string(),
                notes: reminder.notes().map(|s| s.to_string()).unwrap_or_default(),
                due,
                priority: reminder.priority() as u32,
                column: column.into(),
                completed: reminder.isCompleted(),
            },
            recurring: reminder.hasRecurrenceRules(),
        })
    }
}
fn snapshot(store: &EKEventStore, bindings: &Bindings) -> Result<Snapshot> {
    ensure!(
        authorized(),
        "未获得提醒事项完整访问权限，请在系统设置中允许 CodexBuddy Reminders"
    );
    let calendars = calendars(store);
    bindings.validate(&calendars)?;
    let selected = bindings
        .ids()
        .iter()
        .map(|id| unsafe {
            store
                .calendarWithIdentifier(&NSString::from_str(id))
                .context("列表已不可用")
        })
        .collect::<Result<Vec<_>>>()?;
    let array = NSArray::from_retained_slice(&selected);
    let predicate = unsafe { store.predicateForRemindersInCalendars(Some(&array)) };
    let (tx, rx) = mpsc::channel();
    let bindings = bindings.clone();
    let callback = RcBlock::new(move |items: *mut NSArray<EKReminder>| {
        let value = unsafe { items.as_ref() }
            .context("读取提醒事项失败，未把失败解释为空列表")
            .and_then(|items| {
                items
                    .iter()
                    .map(|r| remote(&r, &bindings))
                    .collect::<Result<Vec<_>>>()
            });
        let _ = tx.send(value);
    });
    let fetch = unsafe { store.fetchRemindersMatchingPredicate_completion(&predicate, &callback) };
    let result = wait(rx);
    if result.is_err() {
        unsafe { store.cancelFetchRequest(&fetch) };
    }
    let reminders = result??;
    ensure!(authorized(), "提醒事项权限已变化");
    Ok(Snapshot {
        calendars,
        reminders,
    })
}
fn write(store: &EKEventStore, bindings: &Bindings, intent: Intent) -> Result<Value> {
    ensure!(authorized(), "提醒事项权限已撤销");
    bindings.validate(&calendars(store))?;
    intent.desired.validate()?;
    // Fetch a fresh object immediately before changing only the editable fields.
    let item = if let Some(expected) = &intent.expected {
        let item = unsafe { store.calendarItemWithIdentifier(&NSString::from_str(&expected.id)) }
            .context("提醒事项标识失效或已移除，请先重新同步")?;
        let item = item
            .downcast::<EKReminder>()
            .map_err(|_| anyhow::anyhow!("目标不是提醒事项"))?;
        let current = remote(&item, bindings)?;
        ensure!(
            !current.recurring,
            "重复提醒请在 Apple 提醒事项中编辑，本地只读"
        );
        ensure!(
            current.fields == expected.fields,
            "远端刚刚发生变化，请重新同步后处理冲突"
        );
        item
    } else {
        ensure!(intent.action == "create", "缺少远端身份");
        let marker = format!("codexbuddy://task/{}", intent.task_id);
        let existing = snapshot(store, bindings)?
            .reminders
            .into_iter()
            .filter(|r| r.marker.as_deref() == Some(&marker))
            .collect::<Vec<_>>();
        ensure!(existing.len() <= 1, "创建标记重复，请人工核对");
        if let Some(existing) = existing.first() {
            return Ok(json!({"remote":existing}));
        }
        let reminder = unsafe { EKReminder::reminderWithEventStore(store) };
        unsafe { reminder.setURL(NSURL::URLWithString(&NSString::from_str(&marker)).as_deref()) };
        reminder
    };
    unsafe {
        if intent.action == "delete" {
            store
                .removeReminder_commit_error(&item, true)
                .map_err(|e| anyhow::anyhow!("删除失败：{e}"))?;
            return Ok(json!({"deleted":true}));
        }
        let desired = intent.desired;
        let old = intent.expected.as_ref().map(|r| &r.fields);
        if old.is_none_or(|o| o.title != desired.title) {
            item.setTitle(Some(&NSString::from_str(&desired.title)));
        }
        if old.is_none_or(|o| o.notes != desired.notes) {
            item.setNotes(Some(&NSString::from_str(&desired.notes)));
        }
        if old.is_none_or(|o| o.priority != desired.priority) {
            item.setPriority(desired.priority as usize);
        }
        if old.is_none_or(|o| o.column != desired.column) {
            let id = match desired.column.as_str() {
                "doing" => &bindings.doing,
                "waiting" => &bindings.waiting,
                _ => &bindings.todo,
            };
            let calendar = store
                .calendarWithIdentifier(&NSString::from_str(id))
                .context("目标列表已不可用")?;
            item.setCalendar(Some(&calendar));
        }
        if old.is_none_or(|o| o.due != desired.due) {
            let components = desired
                .due
                .as_ref()
                .map(|d| -> Result<_> {
                    let components = NSDateComponents::new();
                    components.setCalendar(
                        NSCalendar::calendarWithIdentifier(NSCalendarIdentifierGregorian)
                            .as_deref(),
                    );
                    components.setYear(d.year as isize);
                    components.setMonth(d.month as isize);
                    components.setDay(d.day as isize);
                    if let (Some(h), Some(m)) = (d.hour, d.minute) {
                        components.setHour(h as isize);
                        components.setMinute(m as isize);
                    }
                    if let Some(zone) = &d.time_zone {
                        let zone = NSTimeZone::timeZoneWithName(&NSString::from_str(zone))
                            .context("时区无效")?;
                        components.setTimeZone(Some(&zone));
                    }
                    Ok(components)
                })
                .transpose()?;
            item.setDueDateComponents(components.as_deref());
        }
        if old.is_none_or(|o| o.completed != desired.completed) {
            item.setCompleted(desired.completed);
        }
        store
            .saveReminder_commit_error(&item, true)
            .map_err(|e| anyhow::anyhow!("保存失败：{e}"))?;
    }
    Ok(json!({"remote":remote(&item,bindings)?}))
}
fn handle(store: &EKEventStore, request: &Value) -> Result<Value> {
    match request["op"].as_str().unwrap_or("") {
        "status" => Ok(json!({"authorized":authorized()})),
        "authorize" => {
            let (tx, rx) = mpsc::channel();
            let callback =
                RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
                    let result = if granted.as_bool() {
                        Ok(())
                    } else {
                        Err(anyhow::anyhow!(
                            "{}",
                            unsafe { error.as_ref() }
                                .map(|e| e.to_string())
                                .unwrap_or_else(|| "用户未授予提醒事项访问权限".into())
                        ))
                    };
                    let _ = tx.send(result);
                });
            unsafe {
                store.requestFullAccessToRemindersWithCompletion(RcBlock::as_ptr(&callback) as *mut _)
            };
            wait(rx)??;
            Ok(json!({"authorized":authorized(),"calendars":calendars(store)}))
        }
        "calendars" => {
            ensure!(authorized(), "请先授权访问提醒事项");
            Ok(json!({"calendars":calendars(store)}))
        }
        "createLists" => {
            ensure!(authorized(), "请先授权访问提醒事项");
            let source_id = request["source"].as_str().context("请选择账户")?;
            let source = unsafe { store.sourceWithIdentifier(&NSString::from_str(source_id)) }
                .context("账户不存在")?;
            let mut ids = Vec::new();
            for title in ["Buddy · 待办", "Buddy · 进行中", "Buddy · 等待"] {
                let existing: Vec<_> = calendars(store)
                    .into_iter()
                    .filter(|c| c.source == source_id && c.title == title)
                    .collect();
                ensure!(existing.len() <= 1, "同名列表不唯一，请手动选择");
                if let Some(c) = existing.first() {
                    ensure!(c.writable, "同名列表不可写");
                    ids.push(c.id.clone());
                    continue;
                }
                unsafe {
                    let calendar =
                        EKCalendar::calendarForEntityType_eventStore(EKEntityType::Reminder, store);
                    calendar.setTitle(&NSString::from_str(title));
                    calendar.setSource(Some(&source));
                    store
                        .saveCalendar_commit_error(&calendar, true)
                        .map_err(|e| anyhow::anyhow!("创建列表失败：{e}"))?;
                    ids.push(calendar.calendarIdentifier().to_string());
                }
            }
            Ok(
                json!({"calendars":calendars(store),"bindings":{"todo":ids[0],"doing":ids[1],"waiting":ids[2]}}),
            )
        }
        "snapshot" => Ok(serde_json::to_value(snapshot(
            store,
            &serde_json::from_value(request["bindings"].clone())?,
        )?)?),
        "write" => write(
            store,
            &serde_json::from_value(request["bindings"].clone())?,
            serde_json::from_value(request["intent"].clone())?,
        ),
        _ => bail!("不支持的提醒事项操作"),
    }
}

pub fn run(paths: &Paths, lease: &str, runtime_token: &str) -> Result<()> {
    let mtm = MainThreadMarker::new().context("提醒事项辅助进程必须在主线程运行")?;
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(paths.root.join("reminders.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock).context("提醒事项辅助进程已在运行")?;
    let store = unsafe { EKEventStore::new() };
    let ready = paths.root.join("reminders-ready.json");
    write_private(
        &ready,
        &serde_json::to_vec(
            &json!({"lease":lease,"pid":std::process::id(),"runtimeToken":runtime_token}),
        )?,
    )?;
    let mut last = Instant::now();
    loop {
        if !Runtime::read(paths).is_ok_and(|r| r.token == runtime_token) {
            break;
        }
        if std::fs::read_to_string(paths.root.join("reminders-lease"))
            .ok()
            .as_deref()
            != Some(lease)
        {
            break;
        }
        let request_path = paths.root.join("reminders-request.json");
        if let Ok(bytes) = std::fs::read(&request_path) {
            std::fs::remove_file(&request_path)?;
            let request: Value = serde_json::from_slice(&bytes)?;
            if request["lease"].as_str() != Some(lease) {
                continue;
            }
            let result = autoreleasepool(|_| handle(&store, &request));
            let response = match result {
                Ok(value) => json!({"id":request["id"],"value":value}),
                Err(error) => json!({"id":request["id"],"error":error.to_string()}),
            };
            write_private(
                &paths.root.join("reminders-response.json"),
                &serde_json::to_vec(&response)?,
            )?;
            last = Instant::now();
        }
        if last.elapsed() > Duration::from_secs(60) {
            break;
        }
        NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.2));
    }
    let _ = std::fs::remove_file(ready);
    Ok(())
}
