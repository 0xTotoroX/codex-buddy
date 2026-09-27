// [INPUT]: Feature window lease, authenticated local page and saved dimensions.
// [OUTPUT]: Independent resizable native board window with lifecycle polling.
// [POS]: Window child process; closing it never disables reminder sync.
// [PROTOCOL]: Keep src/AGENTS.md in sync when changing the contract.
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
        macos::{ActivationPolicy, EventLoopExtMacOS, WindowExtMacOS},
        run_return::EventLoopExtRunReturn,
    },
    window::WindowBuilder,
};
use wry::WebViewBuilder;

pub fn run(paths: &Paths, feature: &str, lease: &str) -> Result<()> {
    anyhow::ensure!(
        crate::features::IDS.contains(&feature) && crate::panel::popout_supported(),
        "不支持的功能窗口"
    );
    let runtime = Runtime::read(paths)?;
    let mut events = EventLoopBuilder::<Value>::with_user_event().build();
    events.set_activation_policy(ActivationPolicy::Regular);

    let size = [840, 620];
    let window = WindowBuilder::new()
        .with_title(format!(
            "CodexBuddy · {}",
            match feature {
                "outline" => "大纲",
                "next" => "下一步",
                "board" => "看板",
                _ => "模型快切",
            }
        ))
        .with_resizable(true)
        .with_transparent(true)
        .with_visible(false)
        .with_inner_size(LogicalSize::new(size[0], size[1]))
        .with_min_inner_size(LogicalSize::new(320, 280))
        .build(&events)?;
    let page = format!("http://127.0.0.1:{}/feature.html", runtime.port);
    let allowed = page.clone();
    let webview = WebViewBuilder::new()
        .with_transparent(true)
        .with_initialization_script(format!(
            "window.__buddyNativeSurface=true;window.__buddyNativeGlass={};",
            crate::native_backdrop::glass_available()
        ))
        .with_url(format!(
            "{page}?feature={feature}&lease={lease}#token={}",
            runtime.token
        ))
        .with_navigation_handler(move |url| {
            url == allowed || url.starts_with(&format!("{allowed}?"))
        })
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .build(&window)?;
    let native = unsafe { &*(window.ns_window() as *const objc2_app_kit::NSWindow) };
    let backdrop = crate::native_backdrop::Backdrop::new(native);
    let proxy = events.create_proxy();
    let lease = lease.to_owned();
    let feature = feature.to_owned();
    let live = Arc::new(AtomicBool::new(true));
    let polling = live.clone();
    std::thread::spawn(move || {
        let client = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let mut failures = 0;
        while polling.load(Ordering::Relaxed) {
            let result = client.block_on(runtime.request(
                "features",
                Some(json!({"op":"window","id":feature,"owner":lease})),
            ));
            match result {
                Ok(state) => {
                    failures = 0;
                    let _ = proxy.send_event(state);
                }
                Err(_) => {
                    failures += 1;
                    if failures >= 3 {
                        let _ = proxy.send_event(json!({"valid":false}));
                        break;
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
    let mut reveal = 0;
    let mut sized = false;
    let mut resized = None;
    let mut appearance = Value::Null;
    events.run_return(|event, _, control| {
        *control = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));
        match event {
            Event::UserEvent(state) => {
                appearance = state["appearance"].clone();
                update_backdrop(&window, &backdrop, &appearance);
                if !sized
                    && let Ok(size) = serde_json::from_value::<[u32; 2]>(state["size"].clone())
                {
                    window.set_inner_size(LogicalSize::new(size[0], size[1]));
                    sized = true;
                }
                if state["valid"] == false {
                    *control = ControlFlow::Exit;
                }
                if let Some(next) = state["reveal"].as_u64()
                    && next != reveal
                    && state["active"] == true
                {
                    reveal = next;
                    window.set_visible(true);
                    window.set_focus();
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                let _ = webview.evaluate_script("window.dispatchEvent(new Event('feature-close'))");
            }
            Event::WindowEvent {
                event: WindowEvent::Resized(_),
                ..
            } => {
                backdrop.resize_viewport(native, true);
                update_backdrop(&window, &backdrop, &appearance);
                resized = Some(Instant::now());
            }
            Event::MainEventsCleared
                if resized.is_some_and(|at| at.elapsed() > Duration::from_millis(500)) =>
            {
                resized = None;
                let size = window.inner_size().to_logical::<u32>(window.scale_factor());
                let _ = webview.evaluate_script(&format!(
                    "window.dispatchEvent(new CustomEvent('feature-size',{{detail:[{},{}]}}))",
                    size.width, size.height
                ));
            }
            _ => {}
        }
    });
    live.store(false, Ordering::Relaxed);
    Ok(())
}

fn update_backdrop(
    window: &tao::window::Window,
    backdrop: &crate::native_backdrop::Backdrop,
    appearance: &Value,
) {
    let size = window.inner_size().to_logical::<f64>(window.scale_factor());
    let native = unsafe { &*(window.ns_window() as *const objc2_app_kit::NSWindow) };
    backdrop.update(native,&json!({"theme":if appearance["surface"]["theme"]=="black" {json!("dark")} else {appearance["theme"].clone()},"material":appearance["surface"]["theme"],"liquidVariant":appearance["surface"]["liquidVariant"],"x":0,"y":0,"width":size.width,"height":size.height,"radius":0}));
}
