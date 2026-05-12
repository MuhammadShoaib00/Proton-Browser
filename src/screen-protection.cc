#include <napi.h>
#include <windows.h>
#include <dwmapi.h>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "user32.lib")

// Windows 10 build 17134+ required for WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011

// ── Screenshot Protection ─────────────────────────────────────────────────────
Napi::Value SetScreenProtection(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (hwnd: number, enable: boolean)").ThrowAsJavaScriptException();
        return env.Null();
    }

    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    if (!hwnd) {
        Napi::Error::New(env, "Invalid HWND").ThrowAsJavaScriptException();
        return env.Null();
    }

    // WDA_EXCLUDEFROMCAPTURE — window is fully transparent in any screen capture
    // or screen share. Do NOT also call setContentProtection (WDA_MONITOR) as it
    // overwrites this flag and shows a black rectangle instead.
    DWORD affinity = enable ? WDA_EXCLUDEFROMCAPTURE : 0;
    BOOL result = SetWindowDisplayAffinity(hwnd, affinity);
    if (!result) {
        DWORD err = GetLastError();
        std::string msg = "SetWindowDisplayAffinity failed: " + std::to_string(err);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return env.Null();
    }

    // DWM blur — cosmetic only, ignore failures
    DWM_BLURBEHIND bb = {};
    bb.dwFlags = DWM_BB_ENABLE;
    bb.fEnable = enable;
    DwmEnableBlurBehindWindow(hwnd, &bb);

    Napi::Object out = Napi::Object::New(env);
    out.Set("success", Napi::Boolean::New(env, true));
    out.Set("affinity", Napi::Number::New(env, affinity));
    return out;
}

Napi::Value GetScreenProtectionStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (hwnd: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    if (!hwnd) {
        Napi::Error::New(env, "Invalid HWND").ThrowAsJavaScriptException();
        return env.Null();
    }
    DWORD affinity = 0;
    GetWindowDisplayAffinity(hwnd, &affinity);
    Napi::Object out = Napi::Object::New(env);
    out.Set("protected", Napi::Boolean::New(env, affinity == WDA_EXCLUDEFROMCAPTURE));
    out.Set("affinity",  Napi::Number::New(env, affinity));
    return out;
}

// ── Stealth Window Style ──────────────────────────────────────────────────────
// WS_EX_TOOLWINDOW hides the window from EnumWindows and the Alt+Tab switcher.
// Most monitoring tools (Time Doctor, Hubstaff, etc.) enumerate windows with
// EnumWindows to track the active foreground window — this makes the window
// invisible to that enumeration.  The window remains fully functional.
Napi::Value SetStealthWindowStyle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (hwnd: number, enable: boolean)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    if (!hwnd) {
        Napi::Error::New(env, "Invalid HWND").ThrowAsJavaScriptException();
        return env.Null();
    }

    LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
    if (enable) {
        exStyle |=  WS_EX_TOOLWINDOW;  // hide from EnumWindows / Alt+Tab
        exStyle &= ~WS_EX_APPWINDOW;   // suppress taskbar button
    } else {
        exStyle &= ~WS_EX_TOOLWINDOW;
        exStyle |=  WS_EX_APPWINDOW;
    }
    SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);
    // Force a non-resizing re-frame so the style takes effect immediately
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

    return Napi::Boolean::New(env, true);
}

// ── Process Cloaking via AppUserModel ─────────────────────────────────────────
// SetCurrentProcessExplicitAppUserModelID registers the process under a
// different app-model identity — Windows uses this for taskbar grouping,
// Jump Lists, and some monitoring tool process categorisation.
Napi::Value SetProcessAppModelId(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected (appId: string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string appIdStr = info[0].As<Napi::String>().Utf8Value();
    int wlen = MultiByteToWideChar(CP_UTF8, 0, appIdStr.c_str(), -1, nullptr, 0);
    std::vector<wchar_t> wappId(wlen);
    MultiByteToWideChar(CP_UTF8, 0, appIdStr.c_str(), -1, wappId.data(), wlen);

    // Dynamically load SetCurrentProcessExplicitAppUserModelID from shell32
    // (avoids import-table dependency on older shells)
    typedef HRESULT (WINAPI *FnSetAppId)(PCWSTR);
    HMODULE shell32 = LoadLibraryW(L"shell32.dll");
    if (shell32) {
        FnSetAppId fn = (FnSetAppId)GetProcAddress(shell32, "SetCurrentProcessExplicitAppUserModelID");
        if (fn) fn(wappId.data());
        FreeLibrary(shell32);
    }
    return Napi::Boolean::New(env, true);
}

// ── Window Title for GetWindowText callers ────────────────────────────────────
// SetWindowText changes the string that GetWindowText returns — this is what
// monitoring tools read when they call GetWindowText on the foreground window.
Napi::Value SetWindowTextNative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (hwnd: number, title: string)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    std::string titleStr = info[1].As<Napi::String>().Utf8Value();
    if (!hwnd) { Napi::Error::New(env, "Invalid HWND").ThrowAsJavaScriptException(); return env.Null(); }

    int wlen = MultiByteToWideChar(CP_UTF8, 0, titleStr.c_str(), -1, nullptr, 0);
    std::vector<wchar_t> wTitle(wlen);
    MultiByteToWideChar(CP_UTF8, 0, titleStr.c_str(), -1, wTitle.data(), wlen);
    SetWindowTextW(hwnd, wTitle.data());
    return Napi::Boolean::New(env, true);
}

// ── Module Init ───────────────────────────────────────────────────────────────
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setScreenProtection",    Napi::Function::New(env, SetScreenProtection));
    exports.Set("getScreenProtectionStatus", Napi::Function::New(env, GetScreenProtectionStatus));
    exports.Set("setStealthWindowStyle",  Napi::Function::New(env, SetStealthWindowStyle));
    exports.Set("setProcessAppModelId",   Napi::Function::New(env, SetProcessAppModelId));
    exports.Set("setWindowTextNative",    Napi::Function::New(env, SetWindowTextNative));
    return exports;
}

NODE_API_MODULE(screen_protection, Init)
