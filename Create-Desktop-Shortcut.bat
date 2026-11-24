@echo off
setlocal
set "TARGET=%~dp0Start-RomaricksVintage.bat"
set "LINK=%USERPROFILE%\Desktop\Romarick's Vintage.lnk"
set "ICON=%SystemRoot%\System32\shell32.dll,220"

powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%LINK%'); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%ICON%'; $s.Description='Romarick''s Vintage Management System'; $s.Save()"

if exist "%LINK%" (echo Desktop shortcut created: %LINK%) else (echo Failed to create shortcut.)
pause
