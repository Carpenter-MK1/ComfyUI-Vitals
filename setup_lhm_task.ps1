# Register a logon task that starts LibreHardwareMonitor with highest privileges.
# Must run elevated. Writes the result to setup_lhm_task.log next to this script.
#
# The executable is located automatically. Pass -ExePath when it lives somewhere unusual:
#   powershell -NoProfile -ExecutionPolicy Bypass -File setup_lhm_task.ps1 -ExePath "D:\Tools\LibreHardwareMonitor\LibreHardwareMonitor.exe"
param(
    [string]$ExePath = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'setup_lhm_task.log'
$taskName = 'LibreHardwareMonitor-AutoStart'
$user = "$env:USERDOMAIN\$env:USERNAME"

# Order: explicit argument, environment variable, the running instance,
# an already registered task, then common install directories.
# The running instance is the most reliable source on a machine that already uses the plugin,
# because the sensor only works while LibreHardwareMonitor is alive.
function Find-LhmExe {
    if ($ExePath) {
        if (Test-Path $ExePath) { return (Resolve-Path $ExePath).Path }
        throw "ExePath does not exist: $ExePath"
    }

    foreach ($cand in @($env:LHM_EXE, $env:LHM_PATH)) {
        if ($cand -and (Test-Path $cand)) { return (Resolve-Path $cand).Path }
    }

    $proc = Get-Process -Name 'LibreHardwareMonitor*' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path } | Select-Object -First 1
    if ($proc) { return $proc.Path }

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        $act = $task.Actions | Select-Object -First 1
        if ($act -and $act.Execute -and (Test-Path $act.Execute)) { return $act.Execute }
    }

    $dirs = @(
        'C:\AI\LibreHardwareMonitor',
        'C:\Program Files\LibreHardwareMonitor',
        'C:\Program Files (x86)\LibreHardwareMonitor',
        (Join-Path $env:LOCALAPPDATA 'Programs\LibreHardwareMonitor'),
        (Join-Path $env:USERPROFILE 'Downloads\LibreHardwareMonitor'),
        (Join-Path $env:USERPROFILE 'Desktop\LibreHardwareMonitor')
    )
    foreach ($d in $dirs) {
        if (-not $d -or -not (Test-Path $d)) { continue }
        $hit = Get-ChildItem -LiteralPath $d -Filter 'LibreHardwareMonitor.exe' -Recurse -Depth 2 -File -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

try {
    $exe = Find-LhmExe
    if (-not $exe) {
        throw 'LibreHardwareMonitor.exe not found. Pass -ExePath, or set the LHM_EXE environment variable.'
    }

    $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory (Split-Path -Parent $exe)
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $user -RunLevel Highest -LogonType Interactive

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force `
        -Description 'Start LibreHardwareMonitor at logon so the ComfyUI top bar can read CPU temperature.' | Out-Null

    $t = Get-ScheduledTask -TaskName $taskName
    "OK task=$($t.TaskName) state=$($t.State) runlevel=$($t.Principal.RunLevel) trigger=$($t.Triggers[0].CimClass.CimClassName) exe=$exe" |
        Set-Content -Path $log -Encoding UTF8
}
catch {
    "FAIL $($_.Exception.Message)" | Set-Content -Path $log -Encoding UTF8
    exit 1
}
