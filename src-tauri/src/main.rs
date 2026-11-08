#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn set_windows_app_identity() {
    use windows::core::w;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(w!("app.ytmlight.desktop"));
    }
}

#[cfg(not(windows))]
fn set_windows_app_identity() {}

fn main() {
    let mut args = format!(
        "--autoplay-policy=no-user-gesture-required --user-agent=\"{}\"",
        ytm_light_lib::DESKTOP_USER_AGENT
    );
    if let Ok(extra) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        args.push(' ');
        args.push_str(&extra);
    }
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
    set_windows_app_identity();
    ytm_light_lib::run();
}
