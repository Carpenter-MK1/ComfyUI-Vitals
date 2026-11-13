# Register a logon task that starts LibreHardwareMonitor with highest privileges.
# Must run elevated. Writes result to setup_lhm_task.log next to this script.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'setup_lhm_task.log'
$exe = 'C:\AI\LibreHardwareMonitor\LibreHardwareMonitor.exe'
$taskName = 'LibreHardwareMonitor-AutoStart'
$user = "$env:USERDOMAIN\$env:USERNAME"

try {
    if (-not (Test-Path $exe)) { throw "exe not found: $exe" }

    $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory (Split-Path -Parent $exe)
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $user -RunLevel Highest -LogonType Interactive

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force `
        -Description 'Start LibreHardwareMonitor at logon so the ComfyUI Sysmon topbar can read CPU temperature.' | Out-Null

    $t = Get-ScheduledTask -TaskName $taskName
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    "OK task=$($t.TaskName) state=$($t.State) runlevel=$($t.Principal.RunLevel) trigger=$($t.Triggers[0].CimClass.CimClassName)" |
        Set-Content -Path $log -Encoding UTF8
}
catch {
    "FAIL $($_.Exception.Message)" | Set-Content -Path $log -Encoding UTF8
    exit 1
}
