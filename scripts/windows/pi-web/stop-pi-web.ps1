param(
    [ValidateRange(1, 65535)]
    [int]$Port = 30141,
    [switch]$Force,
    [switch]$ProbeOnly
)

$ErrorActionPreference = "Stop"

function Test-PiWebPath {
    param([object]$Process)

    if ($Process.Name -ne "node.exe" -or [string]::IsNullOrWhiteSpace($Process.CommandLine)) {
        return $false
    }

    $command = [string]$Process.CommandLine
    return $command -match '(?i)[\\/]pi-web-gui[\\/]|@agegr[\\/]pi-web'
}

function Test-PiWebPortRoot {
    param([object]$Process)

    if ($Process.Name -ne "node.exe" -or [string]::IsNullOrWhiteSpace($Process.CommandLine)) {
        return $false
    }

    $command = [string]$Process.CommandLine
    $portArgument = $command -match ('(?i)(?:^|\s)(?:-p|--port)\s+' + $Port + '(?:\s|$)')
    if (-not $portArgument) {
        return $false
    }

    return ($command -match '(?i)next[\\/]dist[\\/]bin[\\/]next') -or (Test-PiWebPath $Process)
}

function Test-ListenerIsPiWeb {
    param(
        [object]$Process,
        [int[]]$ListenerIds
    )

    return (
        $ListenerIds -contains [int]$Process.ProcessId -and
        (Test-PiWebPath $Process)
    )
}

function Get-PiWebState {
    $processes = @(Get-CimInstance Win32_Process)
    $listeners = @(
        Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object { $_.RemotePort -eq 0 } |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    $nodeProcesses = @($processes | Where-Object { $_.Name -eq "node.exe" })
    $safeNodes = @(
        $nodeProcesses |
            Where-Object {
                (Test-PiWebPortRoot $_) -or
                (Test-ListenerIsPiWeb $_ $listeners)
            } |
            Sort-Object ProcessId -Unique
    )

    [pscustomobject]@{
        Processes = $processes
        Listeners = $listeners
        SafeNodes = $safeNodes
    }
}

function Add-ProcessTree {
    param(
        [object]$State,
        [int[]]$SeedIds
    )

    $selected = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($id in $SeedIds) {
        [void]$selected.Add($id)
    }

    do {
        $added = $false
        foreach ($process in $State.Processes) {
            if (
                $selected.Contains([int]$process.ParentProcessId) -and
                -not $selected.Contains([int]$process.ProcessId)
            ) {
                [void]$selected.Add([int]$process.ProcessId)
                $added = $true
            }
        }
    } while ($added)

    return $selected
}

$state = Get-PiWebState
if ($ProbeOnly) {
    if ($state.Listeners.Count -gt 0) {
        exit 0
    }
    if ($state.SafeNodes.Count -gt 0) {
        exit 2
    }
    exit 1
}

if ($state.SafeNodes.Count -eq 0 -and $state.Listeners.Count -eq 0) {
    Write-Host ""
    Write-Host "  Pi Web is not running on port $Port."
    Write-Host ""
    exit 0
}

$unsafeListeners = @(
    $state.Listeners |
        Where-Object {
            $pidValue = [int]$_
            -not ($state.SafeNodes | Where-Object { $_.ProcessId -eq $pidValue })
        }
)

if ($unsafeListeners.Count -gt 0 -and -not $Force) {
    Write-Host ""
    Write-Host "  [WARN] Port $Port belongs to a process that is not a Pi Web node."
    Write-Host "         Refusing to stop it. Override with: stop-pi-web.cmd $Port force"
    Write-Host ""
    exit 1
}

$seedIds = @($state.SafeNodes | Select-Object -ExpandProperty ProcessId)
if ($Force) {
    $seedIds += $state.Listeners
}
$seedIds = @($seedIds | Select-Object -Unique)

$selected = Add-ProcessTree -State $state -SeedIds $seedIds
$selectedProcesses = @($state.Processes | Where-Object { $selected.Contains([int]$_.ProcessId) })
$topLevel = @(
    $selectedProcesses |
        Where-Object { -not $selected.Contains([int]$_.ParentProcessId) } |
        Sort-Object ProcessId
)

Write-Host ""
if ($state.Listeners.Count -eq 0) {
    Write-Host "  Found stale Pi Web processes on port $Port (the port is no longer listening):"
} else {
    Write-Host "  Pi Web is listening on port ${Port}:"
}
foreach ($process in $topLevel) {
    Write-Host ("   PID {0}: {1}" -f $process.ProcessId, $process.CommandLine)
}
Write-Host ""
Write-Host "  Stopping the complete process tree."
Write-Host "  Running agents are not shut down gracefully."

foreach ($process in @($selectedProcesses | Sort-Object ProcessId -Descending)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 500
$after = Get-PiWebState
$remainingIds = @($after.SafeNodes | Select-Object -ExpandProperty ProcessId)
if ($remainingIds.Count -gt 0) {
    Write-Host "  Initial stop left processes behind; forcing the remaining Pi Web nodes."
    foreach ($id in $remainingIds) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
    $after = Get-PiWebState
}

if ($after.SafeNodes.Count -gt 0 -or ($Force -and $after.Listeners.Count -gt 0)) {
    Write-Host ""
    Write-Host "  [ERROR] Pi Web processes are still running. PID(s): $((@($after.SafeNodes.ProcessId) + @($after.Listeners) | Sort-Object -Unique) -join ', ')"
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  [OK] Pi Web stopped on port $Port."
Write-Host ""
exit 0
