; Extra Start Menu + Desktop shortcut for shop widgets (same binary, --widget).
; electron-builder includes this for the NSIS Setup target.

!macro customInstall
  CreateDirectory "$SMPROGRAMS\Black Forest Automotive"
  CreateShortCut "$SMPROGRAMS\Black Forest Automotive\Black Forest Shop Widget.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--widget"
  CreateShortCut "$DESKTOP\Black Forest Shop Widget.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--widget"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Black Forest Automotive\Black Forest Shop Widget.lnk"
  Delete "$DESKTOP\Black Forest Shop Widget.lnk"
  RMDir "$SMPROGRAMS\Black Forest Automotive"
!macroend
