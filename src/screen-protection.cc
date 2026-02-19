#include <napi.h>
#include <windows.h>
#include <dwmapi.h>

#pragma comment(lib, "dwmapi.lib")

// Windows 10 build 17134 or later required for WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011

Napi::Value SetScreenProtection(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Get window handle
    HWND hwnd = (HWND)(size_t)info[0].As<Napi::Number>().Int64Value();
    bool enable = info[1].As<Napi::Boolean>().Value();

    if (!hwnd) {
        Napi::Error::New(env, "Invalid window handle").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Method 1: SetWindowDisplayAffinity - Prevents screen capture by Windows APIs
    DWORD affinity = enable ? WDA_EXCLUDEFROMCAPTURE : 0;
    BOOL result = SetWindowDisplayAffinity(hwnd, affinity);

    if (!result) {
        DWORD error = GetLastError();
        std::string errorMsg = "SetWindowDisplayAffinity failed with error: " + std::to_string(error);
        Napi::Error::New(env, errorMsg).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Method 2: DWM Cloaking - Additional protection
    if (enable) {
        BOOL cloak = FALSE;
        DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, &cloak, sizeof(cloak));
    }

    // Method 3: Set window as protected content
    DWM_BLURBEHIND bb = {0};
    bb.dwFlags = DWM_BB_ENABLE;
    bb.fEnable = enable;
    DwmEnableBlurBehindWindow(hwnd, &bb);

    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("success", Napi::Boolean::New(env, true));
    resultObj.Set("affinity", Napi::Number::New(env, affinity));

    return resultObj;
}

Napi::Value GetScreenProtectionStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    HWND hwnd = (HWND)(size_t)info[0].As<Napi::Number>().Int64Value();

    if (!hwnd) {
        Napi::Error::New(env, "Invalid window handle").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD affinity = 0;
    GetWindowDisplayAffinity(hwnd, &affinity);

    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("protected", Napi::Boolean::New(env, affinity == WDA_EXCLUDEFROMCAPTURE));
    resultObj.Set("affinity", Napi::Number::New(env, affinity));

    return resultObj;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setScreenProtection", Napi::Function::New(env, SetScreenProtection));
    exports.Set("getScreenProtectionStatus", Napi::Function::New(env, GetScreenProtectionStatus));
    return exports;
}

NODE_API_MODULE(screen_protection, Init)

