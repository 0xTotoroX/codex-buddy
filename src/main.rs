// [INPUT]: CLI 参数以及 config/lifecycle/server/panel_window 模块。
// [OUTPUT]: codex-buddy 命令分发与进程入口；launch --host-only 供开发入口仅准备宿主。
// [POS]: 独立可执行文件入口，区分后台和窗口子进程。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

mod assets;
mod cdp;
mod config;
mod lifecycle;
mod model;
mod panel;
mod panel_window;
mod requests;
mod server;
mod settings;
mod state;

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "codex-buddy", version, about = "Codex 桌面浮窗与网页配置")]
struct Cli {
    #[arg(long, global = true, help = "本工具数据目录，不影响 CODEX_HOME")]
    data_dir: Option<PathBuf>,
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    #[command(about = "将胶囊弹出到桌面，复用后台与当前连接")]
    Popout,
    #[command(hide = true)]
    PanelWindow {
        #[arg(long)]
        lease: String,
        #[arg(long)]
        activate: bool,
    },
    #[command(about = "启动后台并打开浏览器；已有服务时直接复用")]
    Start {
        #[arg(long, default_value_t = config::DEFAULT_PORT)]
        port: u16,
        #[arg(long)]
        cdp: Option<String>,
        #[arg(long)]
        no_open: bool,
        #[arg(long, hide = true)]
        allow_fixture: bool,
    },
    #[command(about = "在前台运行本地服务")]
    Serve {
        #[arg(long, default_value_t = config::DEFAULT_PORT)]
        port: u16,
        #[arg(long)]
        cdp: Option<String>,
        #[arg(long, hide = true)]
        allow_fixture: bool,
    },
    #[command(about = "查看服务、连接和生成状态")]
    Status,
    #[command(about = "停止本工具，保留桌面 Codex")]
    Stop,
    #[command(about = "检查程序路径、模型模式和调试端点")]
    Doctor {
        #[arg(long)]
        cdp: Option<String>,
    },
    #[command(about = "通过调试参数启动官方 Codex，可按设置重开无连接的宿主")]
    Launch {
        #[arg(
            long,
            conflicts_with = "isolated",
            help = "按启动设置询问或强制重开无调试连接的宿主"
        )]
        restart_running: bool,
        #[arg(
            long,
            conflicts_with = "isolated",
            help = "仅准备宿主并输出调试端点，不启动后台"
        )]
        host_only: bool,
        #[arg(long)]
        app: Option<PathBuf>,
        #[arg(long, help = "用本工具独立的桌面 profile 打开窗口")]
        isolated: bool,
        #[arg(long, help = "连接完成后不打开设置网页")]
        no_open: bool,
    },
    #[command(about = "校验并安装本地产物，保留配置和上一版本")]
    Update {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        sha256: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let paths = config::Paths::new(cli.data_dir)?;
    match cli.command.unwrap_or(Commands::Start {
        port: config::DEFAULT_PORT,
        cdp: None,
        no_open: false,
        allow_fixture: false,
    }) {
        Commands::Popout => {
            lifecycle::start(&paths, config::DEFAULT_PORT, None, true, false).await?;
            lifecycle::Runtime::read(&paths)?
                .request("panel/open", Some(serde_json::json!({})))
                .await?;
            println!("正在打开桌面胶囊；可在展开栏中收回 Codex。");
            Ok(())
        }
        Commands::PanelWindow { lease, activate } => panel_window::run(&paths, &lease, activate),
        Commands::Start {
            port,
            cdp,
            no_open,
            allow_fixture,
        } => lifecycle::start(&paths, port, cdp.as_deref(), no_open, allow_fixture).await,
        Commands::Serve {
            port,
            cdp,
            allow_fixture,
        } => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "codex_buddy=info".into()),
                )
                .with_target(false)
                .init();
            server::serve(paths, port, cdp, allow_fixture).await
        }
        Commands::Status => lifecycle::status(&paths).await,
        Commands::Stop => lifecycle::stop(&paths).await,
        Commands::Doctor { cdp } => lifecycle::doctor(&paths, cdp).await,
        Commands::Launch {
            restart_running,
            host_only,
            app,
            isolated,
            no_open,
        } => lifecycle::launch(&paths, app, isolated, no_open, restart_running, host_only).await,
        Commands::Update { from, sha256 } => lifecycle::update(&paths, &from, &sha256).await,
    }
}
