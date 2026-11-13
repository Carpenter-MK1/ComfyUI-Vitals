@echo off
rem Register the LibreHardwareMonitor logon task.
rem Right-click this file -> "Run as administrator". One UAC prompt, then it is done forever.
rem
rem The executable is located automatically. If it sits somewhere unusual, pass the path:
rem   enable_lhm_autostart.cmd "D:\Tools\LibreHardwareMonitor\LibreHardwareMonitor.exe"
chcp 65001 >nul
set "DIR=%~dp0"
echo.
echo  Registering task: LibreHardwareMonitor-AutoStart
echo  Run level: Highest   Trigger: at logon
if not "%~1"=="" echo  LibreHardwareMonitor: %~1
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%setup_lhm_task.ps1" %*
echo.
echo  ---- result ----
if exist "%DIR%setup_lhm_task.log" (
  type "%DIR%setup_lhm_task.log"
) else (
  echo  [ERROR] no log written, the script did not run
)
echo.
echo  ---- current task state ----
powershell -NoProfile -Command "$t=Get-ScheduledTask -TaskName 'LibreHardwareMonitor-AutoStart' -ErrorAction SilentlyContinue; if($t){'State='+$t.State+'  RunLevel='+$t.Principal.RunLevel+'  Trigger='+$t.Triggers[0].CimClass.CimClassName+'  Exe='+$t.Actions[0].Execute}else{'task not found'}"
echo.
pause
