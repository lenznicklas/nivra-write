//! UI zoom policy, deliberately independent of CSS document zoom.
use tauri::Manager;
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.set_zoom(1.0)?;
    #[cfg(target_os = "linux")]
    window.with_webview(|view| {
        use gtk::prelude::*;
        use webkit2gtk::WebViewExt;
        let inner = view.inner();
        inner.connect_event(|_, event| {
            if event.event_type() == gtk::gdk::EventType::TouchpadPinch {
                gtk::glib::Propagation::Stop
            } else {
                gtk::glib::Propagation::Proceed
            }
        });
        inner.connect_scroll_event(|_, event| {
            if event.state().intersects(
                gtk::gdk::ModifierType::CONTROL_MASK | gtk::gdk::ModifierType::META_MASK,
            ) {
                gtk::glib::Propagation::Stop
            } else {
                gtk::glib::Propagation::Proceed
            }
        });
        inner.connect_zoom_level_notify(|view| {
            if (view.zoom_level() - 1.0).abs() > f64::EPSILON {
                view.set_zoom_level(1.0);
            }
        });
    })?;
    #[cfg(target_os = "macos")]
    window.with_webview(|view| {
        // Tauri guarantees this pointer is its live WKWebView, on the UI thread.
        let inner = unsafe { &*(view.inner() as *const objc2_web_kit::WKWebView) };
        unsafe {
            inner.setAllowsMagnification(false);
        }
    })?;
    // WebView2 IsZoomControlEnabled is disabled by zoomHotkeysEnabled=false.
    Ok(())
}
