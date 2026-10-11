// [INPUT]: 系统进程参数、Codex 安装路径与保存的本机调试地址。
// [OUTPUT]: 宿主进程识别、动态端口发现和启动/重连共用候选地址。
// [POS]: 只读宿主发现；不启动、退出或修改 Codex，Dev/显式目标保持绑定。
// [PROTOCOL]: 变更时同步 src/AGENTS.md。
use anyhow::{Context, Result, bail};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

pub fn find_desktop() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEX_BUDDY_DESKTOP_BIN") {
        return Some(PathBuf::from(path));
    }
    for app in [
        "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        "/Applications/Codex.app/Contents/MacOS/Codex",
    ] {
        if Path::new(app).is_file() {
            return Some(app.into());
        }
    }
    None
}

pub fn desktop_process(executable: &Path) -> Result<Option<i32>> {
    let executable = std::fs::canonicalize(executable).context("桌面程序路径无效")?;
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()?;
    if !output.status.success() {
        bail!("无法检查已打开的桌面程序；未启动新的实例")
    }
    let mut matches = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((pid, path)) = line.trim().split_once(char::is_whitespace) else {
            continue;
        };
        if Path::new(path.trim())
            .canonicalize()
            .is_ok_and(|path| path == executable)
        {
            matches.push(pid.parse::<i32>()?);
        }
    }
    if matches.len() > 1 {
        bail!("发现多个同路径宿主实例，无法确定需要重开的应用；未退出任何实例。")
    }
    Ok(matches.first().copied())
}

pub fn process_debug_endpoint(pid: i32) -> Result<Option<String>> {
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()?;
    if !output.status.success() {
        bail!("读取宿主进程失败，请重试；未退出应用。")
    }
    let args = String::from_utf8_lossy(&output.stdout);
    if args
        .split_whitespace()
        .any(|arg| arg.starts_with("--user-data-dir"))
    {
        bail!("检测到独立 profile 的宿主，请使用其调试连接；不会自动重开独立实例。")
    }
    Ok(debug_endpoint_from_args(&args))
}

pub(crate) fn debug_endpoint_from_args(args: &str) -> Option<String> {
    let mut args = args.split_whitespace();
    while let Some(arg) = args.next() {
        let value = if arg == "--remote-debugging-port" {
            args.next()
        } else {
            arg.strip_prefix("--remote-debugging-port=")
        };
        if let Some(port) = value
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port > 0)
        {
            return Some(format!("http://127.0.0.1:{port}"));
        }
    }
    None
}

pub fn endpoints(saved: Option<&str>, pinned: bool) -> Result<Vec<String>> {
    let mut endpoints: Vec<String> = saved.map(str::to_owned).into_iter().collect();
    if pinned {
        return Ok(endpoints);
    }
    let discovered = (|| -> Result<Option<String>> {
        if let Some(executable) = find_desktop()
            && let Some(pid) = desktop_process(&executable)?
        {
            return process_debug_endpoint(pid);
        }
        Ok(None)
    })();
    match discovered {
        Ok(Some(endpoint)) if !endpoints.contains(&endpoint) => endpoints.push(endpoint),
        // Process discovery must not invalidate an explicit working endpoint, including
        // an isolated profile whose identity cannot be inferred from the process list.
        Err(error) if saved.is_none() => return Err(error),
        _ => {}
    }
    if saved.is_none() {
        for port in [9229, 9231, 9329] {
            let endpoint = format!("http://127.0.0.1:{port}");
            if !endpoints.contains(&endpoint) {
                endpoints.push(endpoint);
            }
        }
    }
    Ok(endpoints)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_changed_debug_ports_from_process_arguments() {
        assert_eq!(
            debug_endpoint_from_args(
                "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --remote-debugging-port=51952"
            ),
            Some("http://127.0.0.1:51952".into())
        );
        assert_eq!(
            debug_endpoint_from_args("a path with spaces --remote-debugging-port 9229"),
            Some("http://127.0.0.1:9229".into())
        );
        for args in [
            "--remote-debugging-port=0",
            "--remote-debugging-port=70000",
            "--remote-debugging-port=bad",
            "--fake-remote-debugging-port=9229",
        ] {
            assert!(debug_endpoint_from_args(args).is_none());
        }
    }
}

#[cfg(test)]
mod binding_tests {
    #[test]
    fn explicit_bindings_never_probe_another_host() {
        assert_eq!(
            super::endpoints(Some("http://127.0.0.1:12345"), true).unwrap(),
            vec!["http://127.0.0.1:12345"]
        );
        assert!(super::endpoints(None, true).unwrap().is_empty());
    }
}
