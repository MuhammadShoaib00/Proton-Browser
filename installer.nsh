; ── QuantumX installer theme ──
;    electron-builder pre-defines the bitmap symbols so we must use /redef to
;    override them; the rest are safe to define fresh.
;    PROJECT_DIR is injected by electron-builder as a command-line /D define.

; Sidebar image – Welcome and Finish pages (164×314 BMP)
!define /redef MUI_WELCOMEFINISHPAGE_BITMAP   "${PROJECT_DIR}\assets\installer-sidebar.bmp"
!define /redef MUI_UNWELCOMEFINISHPAGE_BITMAP "${PROJECT_DIR}\assets\installer-sidebar.bmp"

; Header image – all inner pages (150×57 BMP, right-aligned)
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP   "${PROJECT_DIR}\assets\installer-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${PROJECT_DIR}\assets\installer-header.bmp"

; Background colour for pages without a bitmap (RRGGBB hex) — near-black panel
!define MUI_BGCOLOR   "07080C"
; Cream body text to match the design wordmark
!define MUI_TEXTCOLOR "F4EFE4"

; Installation-progress page colours (text_colour background_colour) — gold on black
!define MUI_INSTFILESPAGE_COLORS "D4B36A 07080C"

; ── Pre-install: detect and remove any previous QuantumX version ───────────
; The app ships as AppRuntime.exe (build.win.executableName) with appId
; com.quantumx.app (build.appId).
!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "AppRuntime.exe" /T'
  Sleep 1000

  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.quantumx.app" "UninstallString"
  ${If} $R0 != ""
    ExecWait '"$R0" /S _?=$INSTDIR' $1
  ${EndIf}

  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.quantumx.app" "UninstallString"
  ${If} $R0 != ""
    ExecWait '"$R0" /S _?=$INSTDIR' $1
  ${EndIf}

  ReadRegStr $R0 HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.quantumx.app" "UninstallString"
  ${If} $R0 != ""
    ExecWait '"$R0" /S _?=$INSTDIR' $1
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\quantumx" "" "URL:QuantumX"
  WriteRegStr HKCU "Software\Classes\quantumx" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\quantumx\shell\open\command" "" '"$INSTDIR\AppRuntime.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\quantumx"
!macroend
