// [INPUT]: JSON task fields and complete EventKit snapshots.
// [OUTPUT]: Durable tasks, list bindings and three-way field merge.
// [POS]: Pure task domain; no native objects, host connection or model calls.
// [PROTOCOL]: Keep tasks/AGENTS.md in sync when changing the contract.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Due {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: Option<u32>,
    pub minute: Option<u32>,
    pub time_zone: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fields {
    pub title: String,
    pub notes: String,
    pub due: Option<Due>,
    pub priority: u32,
    pub column: String,
    pub completed: bool,
}
impl Default for Fields {
    fn default() -> Self {
        Self {
            title: String::new(),
            notes: String::new(),
            due: None,
            priority: 0,
            column: "todo".into(),
            completed: false,
        }
    }
}
impl Fields {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            !self.title.trim().is_empty() && self.title.len() <= 4096,
            "请填写标题（最多 4096 字节）"
        );
        anyhow::ensure!(self.notes.len() <= 32000, "备注过长");
        anyhow::ensure!(self.priority <= 9, "优先级无效");
        anyhow::ensure!(
            ["todo", "doing", "waiting"].contains(&self.column.as_str()),
            "看板列无效"
        );
        if let Some(due) = &self.due {
            let leap = due.year % 4 == 0 && (due.year % 100 != 0 || due.year % 400 == 0);
            let days = match due.month {
                2 => {
                    if leap {
                        29
                    } else {
                        28
                    }
                }
                4 | 6 | 9 | 11 => 30,
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                _ => 0,
            };
            anyhow::ensure!(
                (1..=9999).contains(&due.year) && due.day > 0 && due.day <= days,
                "截止日期无效"
            );
            anyhow::ensure!(
                matches!((due.hour, due.minute), (None, None))
                    || matches!((due.hour,due.minute),(Some(h),Some(m)) if h<24 && m<60),
                "截止时间无效"
            );
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub id: String,
    pub external_id: Option<String>,
    pub marker: Option<String>,
    pub fields: Fields,
    pub recurring: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub fields: Vec<String>,
    pub remote: Remote,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub fields: Fields,
    pub archived: bool,
    pub delete_requested: bool,
    pub remote: Option<Remote>,
    pub remote_missing: bool,
    pub conflict: Option<Conflict>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub title: String,
    pub source: String,
    pub source_title: String,
    pub writable: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub calendars: Vec<Calendar>,
    pub reminders: Vec<Remote>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bindings {
    pub todo: String,
    pub doing: String,
    pub waiting: String,
}
impl Bindings {
    pub fn ids(&self) -> [&str; 3] {
        [&self.todo, &self.doing, &self.waiting]
    }
    pub fn validate(&self, calendars: &[Calendar]) -> anyhow::Result<()> {
        let ids = self.ids();
        anyhow::ensure!(
            ids.iter().all(|id| !id.is_empty())
                && ids[0] != ids[1]
                && ids[1] != ids[2]
                && ids[0] != ids[2],
            "请选择三个不同的提醒事项列表"
        );
        let selected = ids
            .iter()
            .map(|id| {
                calendars
                    .iter()
                    .find(|c| c.id == *id && c.writable)
                    .ok_or_else(|| anyhow::anyhow!("列表不存在或不可写，请重新授权并检查列表"))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        anyhow::ensure!(
            selected.iter().all(|c| c.source == selected[0].source),
            "三个列表必须属于同一个账户"
        );
        Ok(())
    }
    pub fn validate_repair(
        &self,
        replacement: &Self,
        calendars: &[Calendar],
    ) -> anyhow::Result<()> {
        replacement.validate(calendars)?;
        anyhow::ensure!(self != replacement, "请选择替代失效列表");
        for (old, new) in self.ids().into_iter().zip(replacement.ids()) {
            anyhow::ensure!(
                old == new || !calendars.iter().any(|c| c.id == old && c.writable),
                "只能修复缺失或不可写的列表，正常列表绑定保持不变"
            );
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Intent {
    pub task_id: String,
    pub action: String,
    pub expected: Option<Remote>,
    pub desired: Fields,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub schema: u32,
    pub revision: u64,
    pub board_enabled: bool,
    pub sync_enabled: bool,
    pub bindings: Bindings,
    #[serde(default)]
    pub binding_source: Option<String>,
    pub tasks: Vec<Task>,
    pub inflight: Option<Intent>,
    pub window_size: [u32; 2],
}
impl Default for Store {
    fn default() -> Self {
        Self {
            schema: 1,
            revision: 1,
            board_enabled: false,
            sync_enabled: false,
            bindings: Bindings::default(),
            binding_source: None,
            tasks: vec![],
            inflight: None,
            window_size: [1120, 740],
        }
    }
}

pub fn merge(base: &Fields, local: &Fields, remote: &Fields) -> (Fields, Vec<String>) {
    let mut merged = local.clone();
    let mut conflicts = Vec::new();
    macro_rules! field {
        ($name:ident) => {
            if local.$name == base.$name {
                merged.$name = remote.$name.clone();
            } else if remote.$name != base.$name && remote.$name != local.$name {
                conflicts.push(stringify!($name).to_owned());
            }
        };
    }
    field!(title);
    field!(notes);
    field!(due);
    field!(priority);
    field!(column);
    field!(completed);
    (merged, conflicts)
}

pub fn reconcile(store: &mut Store, snapshot: &Snapshot) {
    let mut used = std::collections::HashSet::new();
    for task in &mut store.tasks {
        let Some(base) = task.remote.clone() else {
            continue;
        };
        let matches: Vec<_> = snapshot
            .reminders
            .iter()
            .filter(|r| {
                r.id == base.id
                    || (base.external_id.is_some() && r.external_id == base.external_id)
                    || (base.marker.is_some() && r.marker == base.marker)
            })
            .collect();
        if matches.len() != 1 || !used.insert(matches[0].id.clone()) {
            task.remote_missing = true;
            continue;
        }
        let remote = matches[0];
        task.remote_missing = false;
        let (fields, mut conflicts) = merge(&base.fields, &task.fields, &remote.fields);
        if task.delete_requested && remote.fields != base.fields {
            conflicts.push("delete".into());
        }
        task.fields = fields;
        if conflicts.is_empty() {
            task.conflict = None;
            task.remote = Some(remote.clone());
        } else {
            // Advance only uncontested fields; preserve the common ancestor for
            // outstanding conflicts across repeated remote refreshes.
            let mut baseline = remote.clone();
            if conflicts.iter().any(|f| f == "delete") {
                baseline.fields = base.fields.clone();
            } else {
                let mut value = serde_json::to_value(&baseline.fields).expect("fields serialize");
                let ancestor = serde_json::to_value(&base.fields).expect("fields serialize");
                for field in &conflicts {
                    value[field] = ancestor[field].clone();
                }
                baseline.fields = serde_json::from_value(value).expect("same field schema");
            }
            task.remote = Some(baseline);
            task.conflict = Some(Conflict {
                fields: conflicts,
                remote: remote.clone(),
            });
        }
    }
    for remote in &snapshot.reminders {
        if used.contains(&remote.id)
            || store.tasks.iter().any(|t| {
                t.remote.as_ref().is_some_and(|r| {
                    r.id == remote.id
                        || (r.external_id.is_some() && r.external_id == remote.external_id)
                        || (r.marker.is_some() && r.marker == remote.marker)
                })
            })
        {
            continue;
        }
        store.tasks.push(Task {
            id: uuid::Uuid::new_v4().to_string(),
            fields: remote.fields.clone(),
            archived: false,
            delete_requested: false,
            remote: Some(remote.clone()),
            remote_missing: false,
            conflict: None,
        });
    }
}

/// Reconcile an operation persisted before dispatch without replaying an unknown create.
pub fn recover_inflight(next: &mut Store, snapshot: &Snapshot) {
    if let Some(intent) = next.inflight.clone() {
        let candidates: Vec<_> = snapshot
            .reminders
            .iter()
            .filter(|r| {
                if intent.action == "create" {
                    r.marker.as_deref() == Some(&format!("codexbuddy://task/{}", intent.task_id))
                } else {
                    intent.expected.as_ref().is_some_and(|e| {
                        r.id == e.id || (e.external_id.is_some() && r.external_id == e.external_id)
                    })
                }
            })
            .collect();
        if intent.action == "delete" && candidates.is_empty() {
            // Absence is ambiguous (moved, deleted, or IDs reset); keep a local recovery record.
            if let Some(task) = next.tasks.iter_mut().find(|t| t.id == intent.task_id) {
                task.remote_missing = true;
                task.delete_requested = false;
                task.archived = true;
            }
            next.inflight = None;
        } else if candidates.len() == 1
            && (intent.action == "create" || candidates[0].fields == intent.desired)
        {
            if let Some(task) = next.tasks.iter_mut().find(|t| t.id == intent.task_id) {
                let mut baseline = candidates[0].clone();
                baseline.fields = intent.desired.clone();
                task.remote = Some(baseline);
            }
            next.inflight = None;
        } else if intent.action != "create" {
            next.inflight = None;
        }
    }
}
