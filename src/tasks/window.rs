// [INPUT]: Task window lease, authenticated local page and saved dimensions.
// [OUTPUT]: Independent resizable native board window with lifecycle polling.
// [POS]: Window child process; closing it never disables reminder sync.
// [PROTOCOL]: Keep tasks/AGENTS.md in sync when changing the contract.
use crate::{config::Paths, lifecycle::Runtime};
use anyhow::Result;
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::{
        macos::{ActivationPolicy, EventLoopExtMacOS},
        run_return::EventLoopExtRunReturn,
    },
    window::WindowBuilder,
};
use wry::WebViewBuilder;

pub fn run(paths: &Paths, lease: &str) -> Result<()> {
    let runtime = Runtime::read(paths)?;
    let mut events = EventLoopBuilder::<Value>::with_user_event().build();
    events.set_activation_policy(ActivationPolicy::Regular);
    let store = super::Service::load(paths);
    let size = store.inner.try_lock().unwrap().store.window_size;
    let window = WindowBuilder::new()
        .with_title("CodexBuddy · 任务看板")
        .with_resizable(true)
        .with_inner_size(LogicalSize::new(size[0], size[1]))
        .with_min_inner_size(LogicalSize::new(640, 420))
        .build(&events)?;
    let page = format!("http://127.0.0.1:{}/board.html", runtime.port);
    let allowed = page.clone();
    let webview = WebViewBuilder::new()
        .with_url(format!("{page}#token={}", runtime.token))
        .with_navigation_handler(move |url| {
            url == allowed || url.starts_with(&format!("{allowed}#"))
        })
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .build(&window)?;
    let proxy = events.create_proxy();
    let lease = lease.to_owned();
    let live = Arc::new(AtomicBool::new(true));
    let polling = live.clone();
    std::thread::spawn(move || {
        let client = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let mut failures = 0;
        while polling.load(Ordering::Relaxed) {
            let result = client.block_on(
                runtime.request("tasks/command", Some(json!({"op":"window","lease":lease}))),
            );
            match result {
                Ok(state) => {
                    failures = 0;
                    let _ = proxy.send_event(state);
                }
                Err(_) => {
                    failures += 1;
                    if failures >= 3 {
                        let _ = proxy.send_event(json!({"enabled":false}));
                        break;
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
    let mut reveal = 0;
    let mut resized = None;
    events.run_return(|event, _, control| {
        *control = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));
        match event {
            Event::UserEvent(state) => {
                if state["enabled"] == false {
                    *control = ControlFlow::Exit;
                }
                if let Some(next) = state["reveal"].as_u64()
                    && next != reveal
                {
                    reveal = next;
                    window.set_visible(true);
                    window.set_focus();
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control = ControlFlow::Exit,
            Event::WindowEvent {
                event: WindowEvent::Resized(_),
                ..
            } => resized = Some(Instant::now()),
            Event::MainEventsCleared
                if resized.is_some_and(|at| at.elapsed() > Duration::from_millis(500)) =>
            {
                resized = None;
                let size = window.inner_size().to_logical::<u32>(window.scale_factor());
                let _ = webview.evaluate_script(&format!(
                    "window.dispatchEvent(new CustomEvent('board-size',{{detail:[{},{}]}}))",
                    size.width, size.height
                ));
            }
            _ => {}
        }
    });
    live.store(false, Ordering::Relaxed);
    Ok(())
}
