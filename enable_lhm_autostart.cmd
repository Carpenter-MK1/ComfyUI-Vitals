@echo off
rem Register the LibreHardwareMonitor logon task.
rem Right-click this file -> "Run as administrator". One UAC prompt, then it is done forever.
chcp 65001 >nul
set "DIR=%~dp0"
echo.
echo  Registering task: LibreHardwareMonitor-AutoStart
echo  Run level: Highest   Trigger: at logon
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%setup_lhm_task.ps1"
echo.
echo  ---- result ----
if exist "%DIR%setup_lhm_task.log" (
  type "%DIR%setup_lhm_task.log"
) else (
  echo  [ERROR] no log written, the script did not run
)
echo.
echo  ---- current task state ----
powershell -NoProfile -Command "$t=Get-ScheduledTask -TaskName 'LibreHardwareMonitor-AutoStart' -ErrorAction SilentlyContinue; if($t){'State='+$t.State+'  RunLevel='+$t.Principal.RunLevel+'  Trigger='+$t.Triggers[0].CimClass.CimClassName}else{'task not found'}"
echo.
pause
