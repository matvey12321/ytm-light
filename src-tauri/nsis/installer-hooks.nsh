!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\AppUserModelId\app.ytmlight.desktop" "DisplayName" "YTM Light"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\app.ytmlight.desktop" "IconUri" "$INSTDIR\ytm-light.exe"
  WriteRegDWORD HKCU "Software\Classes\AppUserModelId\app.ytmlight.desktop" "ShowInSettings" 1
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\app.ytmlight.desktop"
!macroend
