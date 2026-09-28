// [INPUT]: Shared main-window identity and lease.
// [OUTPUT]: Original desktop shell, native material and enter/return motion.
// [POS]: Feature adapter over the shared panel window runner; no second window design.
// [PROTOCOL]: Keep src/AGENTS.md in sync.
use crate::config::Paths;
use anyhow::Result;

pub fn run(paths: &Paths, feature: &str, lease: &str) -> Result<()> {
    anyhow::ensure!(feature == "main", "未知功能");
    crate::panel_window::run_surface(paths, lease, true, Some(feature))
}
