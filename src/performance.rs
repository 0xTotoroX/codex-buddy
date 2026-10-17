// [INPUT]: 本机进程资源计数、已连接 CDP 与配置中的独立性能偏好。
// [OUTPUT]: 按需采样后台 CPU/物理内存和宿主页指标；不启动常驻分析器，不保存正文。
// [POS]: 设置诊断服务；CPU 100% 表示一个核心，宿主页内存和长任务不能归因于 Buddy。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::state::App;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub integration_enabled: bool,
    pub monitoring_enabled: bool,
    pub revision: u64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            integration_enabled: true,
            monitoring_enabled: false,
            revision: 0,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Update {
    pub expected_revision: u64,
    pub integration_enabled: Option<bool>,
    pub monitoring_enabled: Option<bool>,
}

#[derive(Default)]
pub(crate) struct Monitor {
    sampled_at: Option<Instant>,
    previous: Option<(Instant, Usage)>,
    cached: Value,
}
#[derive(Clone, Copy)]
struct Usage {
    cpu_ns: u64,
    memory_bytes: u64,
}

#[cfg(target_os = "macos")]
fn usage() -> Option<Usage> {
    // 对应 macOS SDK sys/resource.h 的 rusage_info_v2，无需启动外部 ps 进程。
    #[repr(C)]
    #[derive(Default)]
    struct RUsage {
        uuid: [u8; 16],
        fields: [u64; 18],
    }
    unsafe extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut RUsage) -> i32;
    }
    let mut info = RUsage::default();
    if unsafe { proc_pid_rusage(std::process::id() as i32, 2, &mut info) } != 0 {
        return None;
    }
    Some(Usage {
        cpu_ns: info.fields[0].saturating_add(info.fields[1]),
        memory_bytes: info.fields[7],
    })
}
#[cfg(not(target_os = "macos"))]
fn usage() -> Option<Usage> {
    None
}

fn cpu_percent(previous: Usage, current: Usage, seconds: f64) -> Option<f64> {
    (seconds > 0. && current.cpu_ns >= previous.cpu_ns)
        .then(|| (current.cpu_ns - previous.cpu_ns) as f64 / 1_000_000_000. / seconds * 100.)
}

impl App {
    pub(crate) async fn performance_state(&self, sample: bool) -> Value {
        let preferences = self.config.lock().await.performance.clone();
        let mut monitor = self.performance.lock().await;
        if !preferences.monitoring_enabled {
            *monitor = Monitor::default();
        } else if sample
            && monitor
                .sampled_at
                .as_ref()
                .is_none_or(|at| at.elapsed() >= Duration::from_secs(4))
        {
            let now = Instant::now();
            let current = usage();
            let cpu = current.and_then(|value| {
                monitor.previous.as_ref().and_then(|(at, previous)| {
                    (at.elapsed() <= Duration::from_secs(15))
                        .then(|| {
                            cpu_percent(*previous, value, now.duration_since(*at).as_secs_f64())
                        })
                        .flatten()
                })
            });
            let host = if let Some(client) = self.desktop_client().await {
                client
                    .evaluate_with_timeout(
                        "window.__companionFloatingPanel?.samplePerformance?.() ?? null".into(),
                        Duration::from_secs(1),
                    )
                    .await
                    .unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            monitor.cached = json!({
                "backend": {"pid":std::process::id(),"cpuPercent":cpu,"memoryBytes":current.map(|v|v.memory_bytes)},
                "host":host,
                "sampledAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
            });
            monitor.previous = current.map(|value| (now, value));
            monitor.sampled_at = Some(now);
        }
        json!({"preferences":preferences,"connectionStatus":self.view().connection.status,"sample":monitor.cached})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_configuration_keeps_integration_and_leaves_monitoring_off() {
        let prefs: Preferences = serde_json::from_str("{}").unwrap();
        assert!(prefs.integration_enabled);
        assert!(!prefs.monitoring_enabled);
    }
    #[test]
    fn cpu_counts_one_core_and_handles_first_or_reset_samples() {
        let before = Usage {
            cpu_ns: 2_000_000_000,
            memory_bytes: 0,
        };
        let after = Usage {
            cpu_ns: 3_000_000_000,
            memory_bytes: 0,
        };
        assert_eq!(cpu_percent(before, after, 5.), Some(20.));
        assert_eq!(cpu_percent(after, before, 5.), None);
        assert_eq!(cpu_percent(before, after, 0.), None);
        assert_eq!(cpu_percent(before, after, 0.5), Some(200.));
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn reads_real_process_without_spawning_a_sampler() {
        assert!(usage().unwrap().memory_bytes > 0);
    }
}
