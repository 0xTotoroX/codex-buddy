// [INPUT]: CLI JSON patches, existing authenticated Runtime and backend revision snapshots.
// [OUTPUT]: Discoverable config schema/get/set, redacted previews and guarded service writes.
// [POS]: Thin local service client; no direct config-file edits, host launch or MCP server.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::{config::Paths, lifecycle::Runtime};
use anyhow::{Context, Result, ensure};
use clap::{Subcommand, ValueEnum};
use serde_json::{Value, json};
use std::{io::Read, path::PathBuf};

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum Scope {
    Settings,
    Appearance,
    Surfaces,
    Layout,
    ModelControl,
    Tasks,
    Terminology,
    CodexHost,
    Performance,
}
const SCOPES: [Scope; 9] = [
    Scope::Settings,
    Scope::Appearance,
    Scope::Surfaces,
    Scope::Layout,
    Scope::ModelControl,
    Scope::Tasks,
    Scope::Terminology,
    Scope::CodexHost,
    Scope::Performance,
];
#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum RemindersAction {
    Calendars,
    Authorize,
}
#[derive(Subcommand)]
pub enum Command {
    /// 读取 Apple 提醒事项列表或显式申请系统授权
    Reminders {
        action: RemindersAction,
        #[arg(long)]
        confirm: bool,
    },
    /// 显示配置域、写入字段和JSON示例；无需启动后台
    Schema { scope: Option<Scope> },
    /// 读取配置和修订号；不回读密钥原文
    Get { scope: Option<Scope> },
    /// 通过运行中的后台保存局部JSON；数组为完整替换，失败不会自动重试
    Set {
        scope: Scope,
        #[arg(
            long,
            conflicts_with = "file",
            required_unless_present = "file",
            help = "JSON对象；凭据请使用 --file - 从标准输入传入"
        )]
        json: Option<String>,
        #[arg(
            long,
            conflicts_with = "json",
            help = "JSON文件，- 表示标准输入；输入上限64KiB"
        )]
        file: Option<PathBuf>,
        #[arg(
            long,
            help = "只读取并展示脱敏差异及并发保护值，不写入；非完整后台校验"
        )]
        dry_run: bool,
        #[arg(long, help = "明确确认删除、覆盖列表、授权或重启等操作")]
        confirm: bool,
    },
}
impl Scope {
    fn name(self) -> &'static str {
        match self {
            Self::Settings => "settings",
            Self::Appearance => "appearance",
            Self::Surfaces => "surfaces",
            Self::Layout => "layout",
            Self::ModelControl => "model-control",
            Self::Tasks => "tasks",
            Self::Terminology => "terminology",
            Self::CodexHost => "codex-host",
            Self::Performance => "performance",
        }
    }
    fn read(self) -> (&'static str, Option<Value>) {
        match self {
            Self::Settings => ("settings", None),
            Self::Appearance => ("appearance", None),
            Self::Surfaces => ("surfaces", Some(json!({"op":"state"}))),
            Self::Layout => ("features", Some(json!({"op":"state"}))),
            Self::ModelControl => ("model-control/state", None),
            Self::Tasks => ("tasks/state", None),
            Self::Terminology => ("terminology", None),
            Self::CodexHost => ("codex-host", None),
            Self::Performance => ("performance", None),
        }
    }
    fn write(self) -> &'static str {
        match self {
            Self::Layout => "features",
            Self::ModelControl => "model-control/preferences",
            Self::Tasks => "tasks/command",
            _ => self.name(),
        }
    }
    fn fields(self) -> &'static [&'static str] {
        match self {
            Self::Settings => &[
                "expectedRevision",
                "hostRestartPolicy",
                "enabled",
                "answerOutlineEnabled",
                "promptEnhancementEnabled",
                "generationMode",
                "provider",
                "model",
                "baseUrl",
                "protocol",
                "apiKey",
                "clearApiKey",
                "apiKeyEnv",
                "maxItems",
                "directionSource",
                "directionLibrary",
                "selectedDirections",
                "jev",
                "jevConsent",
                "jevApiKey",
                "clearJevApiKey",
                "quickPrompts",
                "maxInputChars",
                "maxOutputTokens",
                "timeoutMs",
            ],
            Self::Appearance => &[
                "expectedRevision",
                "typography",
                "settingsTheme",
                "alwaysOnTop",
                "launcherAction",
                "settingsTarget",
                "position",
                "ui",
            ],
            Self::Surfaces => &["op", "revision", "placement", "theme", "edge"],
            Self::Layout => &["op", "id", "placement", "layout", "expectedLayout"],
            Self::ModelControl => &["revision", "patch"],
            Self::Tasks => &[
                "op",
                "revision",
                "id",
                "title",
                "fields",
                "before",
                "ids",
                "archived",
                "expectedTask",
                "boardEnabled",
                "syncEnabled",
                "bindings",
                "iCloudConfirmed",
                "confirmRepair",
            ],
            Self::Terminology => &[
                "action",
                "revision",
                "enabled",
                "semantic",
                "autoExpand",
                "jumpOnClick",
                "cardStyle",
                "cardMaterial",
                "cardLiquidVariant",
                "cardCustomColor",
                "cardWidth",
                "entries",
                "id",
            ],
            Self::CodexHost => &["op", "expectedRevision", "enabled", "version"],
            Self::Performance => &[
                "expectedRevision",
                "integrationEnabled",
                "monitoringEnabled",
            ],
        }
    }
    fn operations(self) -> &'static [&'static str] {
        match self {
            Self::Surfaces => &["save"],
            Self::Layout => &["main-placement", "main-layout", "move"],
            Self::Tasks => &[
                "modules",
                "bindings",
                "repairBindings",
                "createColumn",
                "renameColumn",
                "create",
                "update",
                "remove",
                "archive",
                "reorder",
            ],
            Self::Terminology => &[
                "settings",
                "import",
                "manual",
                "master",
                "restore",
                "favorite",
                "unfavorite",
            ],
            Self::CodexHost => &[
                "set-enabled",
                "check-update",
                "install",
                "restore",
                "start",
                "restart-disabled",
            ],
            _ => &[],
        }
    }
    fn example(self) -> Value {
        match self {
            Self::Settings => json!({"generationMode":"manual"}),
            Self::Appearance => json!({"settingsTheme":"codex"}),
            Self::Surfaces => {
                json!({"placement":"sidebar","theme":{"theme":"matte","liquidVariant":"regular"}})
            }
            Self::Layout => json!({"op":"main-placement","placement":"sidebar"}),
            Self::ModelControl => json!({"patch":{"enabled":true}}),
            Self::Tasks => json!({"op":"createColumn","title":"待确认"}),
            Self::Terminology => json!({"jumpOnClick":false}),
            Self::CodexHost => json!({"op":"set-enabled","enabled":false}),
            Self::Performance => json!({"monitoringEnabled":false}),
        }
    }
}
fn schema(scope: Scope) -> Value {
    json!({"scope":scope.name(),"optionalBackend":matches!(scope, Scope::Performance),"fields":scope.fields(),"operations":scope.operations(),"example":scope.example(),"arrays":"完整替换；请先读取现有值并保留不修改的条目","revision":"缺省时读取当前修订；显式修订不覆盖；冲突不自动重试","secrets":"只返回配置状态；写入请用 --file -；预览与输出脱敏","reminders":"config reminders calendars 读取列表；authorize --confirm 申请系统授权；bindings 仍需 iCloudConfirmed:true","taskFields":["title","notes","priority (0=无,1=高,5=中,9=低;保留旧0..9)","due (null或年月日/时分/timeZone)","column","completed"]})
}
fn redacted(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        if ["apiKey", "jevApiKey", "token", "runtimeToken"].contains(&k.as_str()) {
                            json!("[redacted]")
                        } else {
                            redacted(v)
                        },
                    )
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(redacted).collect()),
        _ => value.clone(),
    }
}
fn read_patch(text: Option<String>, file: Option<PathBuf>) -> Result<Value> {
    let bytes = if let Some(text) = text {
        text.into_bytes()
    } else {
        let file = file.context("缺少JSON输入")?;
        let mut bytes = Vec::new();
        if file.as_os_str() == "-" {
            std::io::stdin().take(65537).read_to_end(&mut bytes)?;
        } else {
            std::fs::File::open(file)?
                .take(65537)
                .read_to_end(&mut bytes)?;
        }
        bytes
    };
    ensure!(bytes.len() <= 65536, "JSON输入超过64KiB");
    let value: Value = serde_json::from_slice(&bytes).context("JSON输入无效")?;
    ensure!(
        value.is_object() && !value.as_object().unwrap().is_empty(),
        "请输入非空JSON对象"
    );
    Ok(value)
}
fn guard(patch: &mut Value, key: &str, value: Value) -> Result<()> {
    ensure!(!value.is_null(), "后台没有返回必要的并发保护值");
    if let Some(expected) = patch.get(key) {
        ensure!(expected == &value, "修订已变化；请重新读取并核对修改");
    } else {
        patch[key] = value;
    }
    Ok(())
}
fn prepare(scope: Scope, mut patch: Value, before: &Value) -> Result<Value> {
    for key in patch.as_object().context("请输入JSON对象")?.keys() {
        ensure!(
            scope.fields().contains(&key.as_str()),
            "未知 {} 配置字段：{}",
            scope.name(),
            key
        );
    }
    let operation_key = if matches!(scope, Scope::Terminology) {
        "action"
    } else {
        "op"
    };
    let default = match scope {
        Scope::Surfaces => Some("save"),
        Scope::Terminology => Some("settings"),
        _ => None,
    };
    if patch.get(operation_key).is_none()
        && let Some(value) = default
    {
        patch[operation_key] = json!(value);
    }
    if !scope.operations().is_empty() {
        ensure!(
            scope
                .operations()
                .contains(&patch[operation_key].as_str().unwrap_or("")),
            "不支持的操作；请运行 config schema {}",
            scope.name()
        );
    }
    match scope {
        Scope::Settings => {
            serde_json::from_value::<crate::settings::Update>(patch.clone())
                .context("设置字段类型无效")?;
            guard(
                &mut patch,
                "expectedRevision",
                before["configurationRevision"].clone(),
            )?;
        }
        Scope::Appearance | Scope::CodexHost => {
            guard(&mut patch, "expectedRevision", before["revision"].clone())?
        }
        Scope::Surfaces | Scope::ModelControl => {
            guard(&mut patch, "revision", before["revision"].clone())?
        }
        Scope::Performance => guard(
            &mut patch,
            "expectedRevision",
            before["preferences"]["revision"].clone(),
        )?,
        Scope::Terminology => guard(
            &mut patch,
            "revision",
            before["preferences"]["revision"].clone(),
        )?,
        Scope::Tasks => {
            guard(&mut patch, "revision", before["store"]["revision"].clone())?;
            if patch["op"] == "create" {
                let mut fields = json!({"title":"", "notes":"", "due":null, "priority":0, "column":"todo", "completed":false});
                for (key, value) in patch["fields"].as_object().context("缺少任务 fields")? {
                    ensure!(fields.get(key).is_some(), "未知任务字段：{key}");
                    fields[key] = value.clone();
                }
                patch["fields"] = fields;
            }
            if ["update", "remove", "archive"].contains(&patch["op"].as_str().unwrap_or("")) {
                let task = before["store"]["tasks"]
                    .as_array()
                    .and_then(|a| a.iter().find(|t| t["id"] == patch["id"]))
                    .context("任务不存在")?;
                guard(&mut patch, "expectedTask", task.clone())?;
                // Task edits are partial at the CLI boundary; preserve every unmentioned field.
                if patch["op"] == "update" {
                    let mut fields = task["fields"].clone();
                    for (k, v) in patch["fields"]
                        .as_object()
                        .context("缺少任务 fields 补丁")?
                    {
                        ensure!(fields.get(k).is_some(), "未知任务字段：{k}");
                        fields[k] = v.clone();
                    }
                    patch["fields"] = fields;
                }
            }
        }
        Scope::Layout => {
            if patch["op"] == "main-layout" {
                let placement = patch["placement"].as_str().context("缺少placement")?;
                let old = before["layouts"][placement].clone();
                if let Some(expected) = patch.get("expectedLayout") {
                    ensure!(expected == &old, "布局已变化，请重新读取");
                } else {
                    patch["expectedLayout"] = old;
                }
            }
        }
    }
    Ok(patch)
}
fn dangerous(scope: Scope, patch: &Value, before: &Value) -> bool {
    let op = patch["op"].as_str().unwrap_or("");
    patch["clearApiKey"] == true
        || patch["clearJevApiKey"] == true
        || patch["hostRestartPolicy"] == "force"
        || patch["jevConsent"] == true
        || patch["syncEnabled"] == true
        || patch["action"] == "import"
        || [
            "remove",
            "restore",
            "restart-disabled",
            "install",
            "start",
            "bindings",
            "repairBindings",
        ]
        .contains(&op)
        || ["quickPrompts", "directionLibrary", "selectedDirections"]
            .iter()
            .any(|key| {
                patch[*key].as_array().is_some_and(|p| {
                    before[*key].as_array().is_some_and(|b| {
                        b.iter().any(|old| {
                            !p.iter().any(|new| {
                                old.get("id")
                                    .map_or(old == new, |id| new.get("id") == Some(id))
                            })
                        })
                    })
                })
            })
        || matches!(scope, Scope::ModelControl)
            && ["groups", "presets", "pinned"].iter().any(|key| {
                patch["patch"][*key].as_array().is_some_and(|p| {
                    before["preferences"][*key].as_array().is_some_and(|b| {
                        b.iter().any(|old| {
                            !p.iter().any(|new| {
                                old.get("id")
                                    .map_or(old == new, |id| new.get("id") == Some(id))
                            })
                        })
                    })
                })
            })
}
pub async fn run(paths: &Paths, command: Command) -> Result<()> {
    let output = match command {
        Command::Schema { scope } => scope
            .map(schema)
            .unwrap_or_else(|| Value::Array(SCOPES.into_iter().map(schema).collect())),
        command => {
            let runtime = Runtime::read(paths)
                .context("后台未运行；先启动所需的开发版或正式版服务，CLI不会自动重启宿主")?;
            match command {
                Command::Reminders { action, confirm } => {
                    let op = match action {
                        RemindersAction::Calendars => "calendars",
                        RemindersAction::Authorize => {
                            ensure!(confirm, "系统授权需要添加 --confirm");
                            "authorize"
                        }
                    };
                    runtime
                        .request("tasks/command", Some(json!({"op":op})))
                        .await?
                }
                Command::Get { scope } => {
                    if let Some(scope) = scope {
                        let (path, body) = scope.read();
                        runtime.request(path, body).await?
                    } else {
                        let mut all = json!({});
                        for scope in SCOPES {
                            let (path, body) = scope.read();
                            let result = runtime.request(path, body).await;
                            all[scope.name()] = if matches!(scope, Scope::Performance) {
                                result.unwrap_or_else(
                                    |error| json!({"available":false,"message":error.to_string()}),
                                )
                            } else {
                                result?
                            };
                        }
                        all
                    }
                }
                Command::Set {
                    scope,
                    json: text,
                    file,
                    dry_run,
                    confirm,
                } => {
                    let patch = read_patch(text, file)?;
                    let (path, body) = scope.read();
                    let before = runtime.request(path, body).await?;
                    let patch = prepare(scope, patch, &before)?;
                    let confirmation = dangerous(scope, &patch, &before);
                    if dry_run {
                        json!({"dryRun":true,"scope":scope.name(),"validation":"仅客户端字段/修订检查；完整校验由保存时后台执行","confirmationRequired":confirmation,"before":before,"patch":patch})
                    } else {
                        ensure!(
                            !confirmation || confirm,
                            "此操作需要明确确认；先用 --dry-run 核对，再添加 --confirm"
                        );
                        let result = runtime.request(scope.write(), Some(patch)).await?;
                        let (path, body) = scope.read();
                        json!({"saved":true,"scope":scope.name(),"result":result,"current":runtime.request(path,body).await?})
                    }
                }
                _ => unreachable!(),
            }
        }
    };
    println!("{}", serde_json::to_string_pretty(&redacted(&output))?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn patches_keep_revisions_and_task_fields() {
        let before = json!({"store":{"revision":7,"tasks":[{"id":"a","fields":{"title":"original","notes":"retain","due":null,"priority":3,"column":"todo","completed":false}}]}});
        let p = prepare(
            Scope::Tasks,
            json!({"op":"update","id":"a","fields":{"priority":9}}),
            &before,
        )
        .unwrap();
        assert_eq!(p["fields"]["notes"], "retain");
        assert_eq!(p["fields"]["priority"], 9);
        assert_eq!(p["revision"], 7);
        assert_eq!(p["expectedTask"], before["store"]["tasks"][0]);
        assert!(
            prepare(
                Scope::Tasks,
                json!({"op":"update","id":"a","revision":6,"fields":{"priority":9}}),
                &before
            )
            .is_err()
        );
        assert!(
            prepare(
                Scope::Appearance,
                json!({"typo":true}),
                &json!({"revision":1})
            )
            .is_err()
        );
    }
    #[test]
    fn secrets_and_dangerous_operations() {
        let v = redacted(
            &json!({"patch":{"apiKey":"secret","jevApiKey":"other"},"apiKeyConfigured":true}),
        );
        assert!(!v.to_string().contains("secret"));
        assert_eq!(v["apiKeyConfigured"], true);
        assert!(dangerous(
            Scope::Settings,
            &json!({"clearApiKey":true}),
            &json!({})
        ));
        assert!(dangerous(
            Scope::Settings,
            &json!({"quickPrompts":[]}),
            &json!({"quickPrompts":[{"label":"keep"}]})
        ));
        assert!(!dangerous(
            Scope::Settings,
            &json!({"generationMode":"manual"}),
            &json!({})
        ));
    }
}
