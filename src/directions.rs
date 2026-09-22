// [INPUT]: Stepwise 方向偏好与完整最近一问一答。
// [OUTPUT]: 方向库校验、有效生成配置与带完整性标记的上下文快照。
// [POS]: 三种方向来源的共享数据规则，不执行模型请求。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectionSource {
    #[default]
    Auto,
    Manual,
    Smart,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Direction {
    pub id: String,
    pub name: String,
    pub instruction: String,
    pub enabled: bool,
}

pub fn defaults() -> Vec<Direction> {
    [
        (
            "advance",
            "整体推进",
            "承接当前整体目标，保留共同待办、依赖和授权边界，提出可完整推进的下一步。",
        ),
        (
            "understand",
            "理解解释",
            "针对当前回答中影响理解的概念、术语或推导提出具体解释需求；不硬凑术语。",
        ),
        (
            "evidence",
            "核查依据",
            "关注当前结论的证据、来源与可验证性，提出有针对性的核查问题，不编造来源。",
        ),
        (
            "compare",
            "比较选择",
            "比较当前真正存在的备选方案及取舍，帮助用户决定，不把互斥方案一起执行。",
        ),
        (
            "gaps",
            "检查遗漏",
            "检查与目标有关的遗漏、假设、约束或失败边界，不凭空制造问题。",
        ),
        (
            "explore",
            "探索拓展",
            "提出与当前目标有关但尚未展开的有价值方向，不擅自扩大执行范围。",
        ),
    ]
    .into_iter()
    .map(|(id, name, instruction)| Direction {
        id: id.into(),
        name: name.into(),
        instruction: instruction.into(),
        enabled: true,
    })
    .collect()
}

pub fn validate(library: &mut [Direction], selected: &[String]) -> Result<()> {
    if library.len() > 24 || selected.len() > 6 {
        bail!("方向库最多 24 项，方向位置最多 6 个");
    }
    let mut ids = HashSet::new();
    for item in library {
        item.name = item.name.trim().to_owned();
        item.instruction = item.instruction.trim().to_owned();
        if item.id.is_empty()
            || item.id.len() > 80
            || !item
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            || !ids.insert(item.id.clone())
        {
            bail!("方向 ID 无效或重复");
        }
        if item.name.is_empty()
            || item.name.chars().count() > 40
            || item.instruction.is_empty()
            || item.instruction.chars().count() > 4000
        {
            bail!("方向需要 1–40 字的名称和 1–4000 字的倾向说明");
        }
    }
    let mut used = HashSet::new();
    for id in selected {
        if !ids.contains(id) || !used.insert(id) {
            bail!("所选方向不存在或重复");
        }
    }
    Ok(())
}

pub fn selected(options: &crate::settings::Options) -> Vec<Direction> {
    options
        .selected_directions
        .iter()
        .filter_map(|id| options.direction_library.iter().find(|item| &item.id == id))
        .cloned()
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exchange {
    pub user_question: String,
    pub assistant_answer: String,
    pub user_question_present: bool,
    pub truncated: bool,
    pub original_question_chars: usize,
    pub original_answer_chars: usize,
}

impl Exchange {
    pub fn new(user: &str, answer: &str, limit: usize) -> Self {
        let user_len = user.chars().count();
        let answer_len = answer.chars().count();
        // Keep the user's goal and constraints first; the positive budget is explicit.
        let question_len = if limit == 0 {
            user_len
        } else {
            user_len.min(limit)
        };
        let answer_budget = if limit == 0 {
            answer_len
        } else {
            limit.saturating_sub(question_len)
        };
        Self {
            user_question: user.chars().take(question_len).collect(),
            assistant_answer: answer.chars().take(answer_budget).collect(),
            user_question_present: !user.trim().is_empty(),
            truncated: limit > 0 && user_len.saturating_add(answer_len) > limit,
            original_question_chars: user_len,
            original_answer_chars: answer_len,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_complete_exchange_and_marks_explicit_budget() {
        let user = format!("仅讨论{}不发布", "问🦀".repeat(40000));
        let answer = "答🦀".repeat(50000);
        let full = Exchange::new(&user, &answer, 0);
        assert_eq!(full.user_question, user);
        assert_eq!(full.assistant_answer, answer);
        assert!(!full.truncated);
        let small = Exchange::new("仅讨论，不执行", &answer, 500);
        assert_eq!(small.user_question, "仅讨论，不执行");
        assert_eq!(
            small.user_question.chars().count() + small.assistant_answer.chars().count(),
            500
        );
        assert!(small.truncated);
        assert!(!Exchange::new("", "answer", 0).user_question_present);
    }
    #[test]
    fn rejects_duplicate_and_missing_direction_references() {
        assert!(validate(&mut defaults(), &["gaps".into()]).is_ok());
        assert!(validate(&mut defaults(), &["missing".into()]).is_err());
        assert!(validate(&mut defaults(), &["gaps".into(), "gaps".into()]).is_err());
    }
}
