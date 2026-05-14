#include <napi.h>
#include <windows.h>
#include <dwmapi.h>
#include <psapi.h>
#include <string>
#include <vector>
#include <utility>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "psapi.lib")

// ── Shared helpers ────────────────────────────────────────────────────────────
static std::string WideToUtf8(const wchar_t* w, int wlen = -1) {
    if (!w || !*w) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w, wlen, nullptr, 0, nullptr, nullptr);
    if (n <= 0) return {};
    std::vector<char> buf(n);
    WideCharToMultiByte(CP_UTF8, 0, w, wlen, buf.data(), n, nullptr, nullptr);
    // wlen==-1 means null-terminated, n includes the null → strip it
    return std::string(buf.data(), wlen == -1 ? n - 1 : n);
}

static std::wstring GetExePathByPid(DWORD pid) {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!h) return {};
    wchar_t buf[MAX_PATH + 1] = {};
    DWORD sz = MAX_PATH;
    QueryFullProcessImageNameW(h, 0, buf, &sz);
    CloseHandle(h);
    return std::wstring(buf, sz);
}

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

// ── Window Embedding ──────────────────────────────────────────────────────────

static void StripWindowFrame(HWND hwnd) {
    LONG_PTR style = GetWindowLongPtr(hwnd, GWL_STYLE);
    style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER);
    style |= WS_CHILD;
    SetWindowLongPtr(hwnd, GWL_STYLE, style);
    LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
    exStyle &= ~(WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE | WS_EX_TOOLWINDOW | WS_EX_APPWINDOW);
    SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
}

// EmbedWindow(mainHwnd, targetHwnd, x, y, w, h)
Napi::Value EmbedWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 6) {
        Napi::TypeError::New(env, "Expected (mainHwnd, targetHwnd, x, y, w, h)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND mainHwnd   = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    HWND targetHwnd = (HWND)(uintptr_t)info[1].As<Napi::Number>().Int64Value();
    int x = info[2].As<Napi::Number>().Int32Value();
    int y = info[3].As<Napi::Number>().Int32Value();
    int w = info[4].As<Napi::Number>().Int32Value();
    int h = info[5].As<Napi::Number>().Int32Value();
    if (!mainHwnd || !targetHwnd) {
        Napi::Error::New(env, "Invalid HWND").ThrowAsJavaScriptException();
        return env.Null();
    }
    StripWindowFrame(targetHwnd);
    SetParent(targetHwnd, mainHwnd);
    MoveWindow(targetHwnd, x, y, w, h, TRUE);
    ShowWindow(targetHwnd, SW_SHOW);
    return Napi::Boolean::New(env, true);
}

// ReleaseWindow(targetHwnd) — detaches and restores the embedded window to desktop
Napi::Value ReleaseWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (targetHwnd)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND targetHwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    if (!targetHwnd) return Napi::Boolean::New(env, false);
    LONG_PTR style = GetWindowLongPtr(targetHwnd, GWL_STYLE);
    style &= ~WS_CHILD;
    style |= WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    SetWindowLongPtr(targetHwnd, GWL_STYLE, style);
    LONG_PTR exStyle = GetWindowLongPtr(targetHwnd, GWL_EXSTYLE);
    exStyle |= WS_EX_APPWINDOW;
    SetWindowLongPtr(targetHwnd, GWL_EXSTYLE, exStyle);
    SetParent(targetHwnd, NULL);
    SetWindowPos(targetHwnd, nullptr, 100, 100, 800, 600,
        SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    ShowWindow(targetHwnd, SW_SHOW);
    return Napi::Boolean::New(env, true);
}

// MoveEmbedWindow(targetHwnd, x, y, w, h)
Napi::Value MoveEmbedWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 5) {
        Napi::TypeError::New(env, "Expected (targetHwnd, x, y, w, h)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND targetHwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    int x = info[1].As<Napi::Number>().Int32Value();
    int y = info[2].As<Napi::Number>().Int32Value();
    int w = info[3].As<Napi::Number>().Int32Value();
    int h = info[4].As<Napi::Number>().Int32Value();
    if (!targetHwnd) return Napi::Boolean::New(env, false);
    MoveWindow(targetHwnd, x, y, w, h, TRUE);
    return Napi::Boolean::New(env, true);
}

// ShowHideEmbedWindow(targetHwnd, show: bool)
Napi::Value ShowHideEmbedWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (targetHwnd, show)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND targetHwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    bool show = info[1].As<Napi::Boolean>().Value();
    if (!targetHwnd) return Napi::Boolean::New(env, false);
    ShowWindow(targetHwnd, show ? SW_SHOW : SW_HIDE);
    return Napi::Boolean::New(env, true);
}

struct WindowEnumData {
    std::vector<std::tuple<uintptr_t, std::wstring, DWORD>>* windows;
    DWORD ownPid;
};

static BOOL CALLBACK CollectVisibleWindows(HWND hwnd, LPARAM lParam) {
    auto* data = reinterpret_cast<WindowEnumData*>(lParam);
    if (!IsWindowVisible(hwnd)) return TRUE;
    wchar_t title[512] = {};
    GetWindowTextW(hwnd, title, 512);
    if (wcslen(title) == 0) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == data->ownPid) return TRUE;
    data->windows->emplace_back((uintptr_t)hwnd, std::wstring(title), pid);
    return TRUE;
}

// EnumVisibleWindows() → [{hwnd, title, pid, exePath}, ...]
Napi::Value EnumVisibleWindows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::vector<std::tuple<uintptr_t, std::wstring, DWORD>> windows;
    WindowEnumData enumData = { &windows, GetCurrentProcessId() };
    EnumWindows(CollectVisibleWindows, (LPARAM)&enumData);

    Napi::Array result = Napi::Array::New(env, windows.size());
    for (size_t i = 0; i < windows.size(); i++) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("hwnd",    Napi::Number::New(env, (double)std::get<0>(windows[i])));
        obj.Set("title",   Napi::String::New(env, WideToUtf8(std::get<1>(windows[i]).c_str())));
        obj.Set("pid",     Napi::Number::New(env, (double)std::get<2>(windows[i])));
        std::wstring exePath = GetExePathByPid(std::get<2>(windows[i]));
        obj.Set("exePath", Napi::String::New(env, WideToUtf8(exePath.c_str())));
        result[i] = obj;
    }
    return result;
}

struct PidHwndSearch {
    DWORD pid;
    HWND  hwnd;
};

static BOOL CALLBACK FindMainWindowByPid(HWND hwnd, LPARAM lParam) {
    auto* data = reinterpret_cast<PidHwndSearch*>(lParam);
    if (!IsWindowVisible(hwnd)) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid != data->pid) return TRUE;
    wchar_t title[256] = {};
    GetWindowTextW(hwnd, title, 256);
    if (wcslen(title) == 0) return TRUE;
    data->hwnd = hwnd;
    return FALSE;
}

// LaunchAndGetWindow(exePath) → {hwnd, pid}
// Launches an .exe and waits up to 5 s for its main window to appear
Napi::Value LaunchAndGetWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected (exePath: string)").ThrowAsJavaScriptException();
        return env.Null();
    }
    std::string pathStr = info[0].As<Napi::String>().Utf8Value();
    int wlen = MultiByteToWideChar(CP_UTF8, 0, pathStr.c_str(), -1, nullptr, 0);
    std::vector<wchar_t> wpath(wlen);
    MultiByteToWideChar(CP_UTF8, 0, pathStr.c_str(), -1, wpath.data(), wlen);

    STARTUPINFOW si = {};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi = {};
    Napi::Object result = Napi::Object::New(env);

    if (!CreateProcessW(wpath.data(), nullptr, nullptr, nullptr, FALSE,
                        0, nullptr, nullptr, &si, &pi)) {
        result.Set("hwnd", Napi::Number::New(env, 0));
        result.Set("pid",  Napi::Number::New(env, 0));
        result.Set("error", Napi::String::New(env, "CreateProcessW failed: " + std::to_string(GetLastError())));
        return result;
    }
    DWORD pid = pi.dwProcessId;
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);

    PidHwndSearch findData = { pid, nullptr };
    for (int i = 0; i < 50 && !findData.hwnd; i++) {
        Sleep(100);
        EnumWindows(FindMainWindowByPid, (LPARAM)&findData);
    }
    result.Set("hwnd", Napi::Number::New(env, (double)(uintptr_t)findData.hwnd));
    result.Set("pid",  Napi::Number::New(env, (double)pid));
    return result;
}

// IsWindowValid(hwnd) → bool — checks that the HWND still refers to a live window
Napi::Value IsWindowValid(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    return Napi::Boolean::New(env, hwnd && IsWindow(hwnd));
}

// GetWindowProcessPath(hwnd) → string (full exe path or empty)
Napi::Value GetWindowProcessPath(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::String::New(env, "");
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    if (!hwnd || !IsWindow(hwnd)) return Napi::String::New(env, "");
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (!pid) return Napi::String::New(env, "");
    std::wstring path = GetExePathByPid(pid);
    return Napi::String::New(env, WideToUtf8(path.c_str()));
}

// GetWindowTitle(hwnd) → string
Napi::Value GetWindowTitle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (hwnd: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    if (!hwnd) return Napi::String::New(env, "");
    wchar_t title[512] = {};
    GetWindowTextW(hwnd, title, 512);
    int utf8len = WideCharToMultiByte(CP_UTF8, 0, title, -1, nullptr, 0, nullptr, nullptr);
    std::vector<char> utf8buf(utf8len > 0 ? utf8len : 1);
    WideCharToMultiByte(CP_UTF8, 0, title, -1, utf8buf.data(), utf8len, nullptr, nullptr);
    return Napi::String::New(env, std::string(utf8buf.data(), utf8len > 1 ? utf8len - 1 : 0));
}

// ── Module Init ───────────────────────────────────────────────────────────────
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setScreenProtection",    Napi::Function::New(env, SetScreenProtection));
    exports.Set("getScreenProtectionStatus", Napi::Function::New(env, GetScreenProtectionStatus));
    exports.Set("setStealthWindowStyle",  Napi::Function::New(env, SetStealthWindowStyle));
    exports.Set("setProcessAppModelId",   Napi::Function::New(env, SetProcessAppModelId));
    exports.Set("setWindowTextNative",    Napi::Function::New(env, SetWindowTextNative));
    exports.Set("embedWindow",            Napi::Function::New(env, EmbedWindow));
    exports.Set("releaseWindow",          Napi::Function::New(env, ReleaseWindow));
    exports.Set("moveEmbedWindow",        Napi::Function::New(env, MoveEmbedWindow));
    exports.Set("showHideEmbedWindow",    Napi::Function::New(env, ShowHideEmbedWindow));
    exports.Set("enumVisibleWindows",     Napi::Function::New(env, EnumVisibleWindows));
    exports.Set("launchAndGetWindow",     Napi::Function::New(env, LaunchAndGetWindow));
    exports.Set("getWindowTitle",         Napi::Function::New(env, GetWindowTitle));
    exports.Set("isWindowValid",          Napi::Function::New(env, IsWindowValid));
    exports.Set("getWindowProcessPath",   Napi::Function::New(env, GetWindowProcessPath));
    return exports;
}

NODE_API_MODULE(screen_protection, Init)
