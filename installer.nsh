; ── Blue theme ── electron-builder pre-defines the bitmap symbols so we
;    must use /redef to override them; the rest are safe to define fresh.
; PROJECT_DIR is injected by electron-builder as a command-line /D define.

; Sidebar image – Welcome and Finish pages (164×314 BMP)
!define /redef MUI_WELCOMEFINISHPAGE_BITMAP   "${PROJECT_DIR}\assets\installer-sidebar.bmp"
!define /redef MUI_UNWELCOMEFINISHPAGE_BITMAP "${PROJECT_DIR}\assets\installer-sidebar.bmp"

; Header image – all inner pages (150×57 BMP, right-aligned)
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP   "${PROJECT_DIR}\assets\installer-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${PROJECT_DIR}\assets\installer-header.bmp"

; Background colour for pages without a bitmap (RRGGBB hex)
!define MUI_BGCOLOR   "04090F"
!define MUI_TEXTCOLOR "DBEAFE"

; Installation-progress page colours (text_colour background_colour)
!define MUI_INSTFILESPAGE_COLORS "60A5FA 04090F"

; ── Pre-install: detect and remove any previous Proton Browser version ─────
!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "Proton Browser.exe" /T'
  Sleep 1000

  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.protonbrowser.app" "UninstallString"
  ${If} $R0 != ""
    ExecWait '"$R0" /S _?=$INSTDIR' $1
  ${EndIf}

  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.protonbrowser.app" "UninstallString"
  ${If} $R0 != ""
    ExecWait '"$R0" /S _?=$INSTDIR' $1
  ${EndIf}

  ReadRegStr $R0 HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.protonbrowser.app" "UninstallString"
  ${If} $R0 != ""
    ExecWait '"$R0" /S _?=$INSTDIR' $1
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\protonbrowser" "" "URL:Proton Browser"
  WriteRegStr HKCU "Software\Classes\protonbrowser" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\protonbrowser\shell\open\command" "" '"$INSTDIR\Proton Browser.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\protonbrowser"
!macroend
