<#
.SYNOPSIS
Watches for new console-related processes and their visible windows.
.DESCRIPTION
Polls Win32_Process without administrator rights. Records matching process names,
their command lines and parent chains to the console and a log file. Window
ownership is checked on the following poll, so very short-lived windows may be
missed. Stop with Ctrl+C.
.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\diagnostics\watch-console-spawns.ps1
#>
param(
    [ValidateRange(1, 60000)][int]$IntervalMs = 250,
    [string[]]$Names = @('cmd.exe', 'conhost.exe', 'OpenConsole.exe', 'powershell.exe', 'pwsh.exe',
        'git.exe', 'bash.exe', 'sh.exe', 'node.exe', 'taskkill.exe', 'where.exe',
        'gh.exe', 'ffmpeg.exe', 'codex.exe', 'copilot*', 'antigravity*',
        'claude.exe'),
    [switch]$All,
    [string]$LogPath = "$env:TEMP\ptah-console-spawns.log",
    [ValidateRange(0, 2147483647)][int]$DurationSeconds = 0
)

$ErrorActionPreference = 'Stop'
$LogPath = [System.IO.Path]::GetFullPath($LogPath)
$logDirectory = [System.IO.Path]::GetDirectoryName($LogPath)
if (-not [System.IO.Directory]::Exists($logDirectory)) {
    [void][System.IO.Directory]::CreateDirectory($logDirectory)
}
Write-Host "Log: $LogPath"

function Write-Record {
    param([string]$Line)
    Write-Host $Line
    Add-Content -LiteralPath $LogPath -Value $Line -Encoding UTF8
}

function Get-ProcessSnapshot {
    $snapshot = @{}
    foreach ($process in @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine)) {
        if ($null -eq $process) { continue }
        $pidKey = [int]$process.ProcessId
        $snapshot[$pidKey] = [pscustomobject]@{
            ProcessId = $pidKey
            ParentProcessId = [int]$process.ParentProcessId
            Name = [string]$process.Name
            CommandLine = [string]$process.CommandLine
        }
    }
    return ,$snapshot
}

function Test-NameMatch {
    param([string]$ProcessName)
    if ($All) { return $true }
    foreach ($pattern in $Names) {
        if ($ProcessName -like $pattern) { return $true }
    }
    return $false
}

function Get-Ancestry {
    param($Process, [hashtable]$Current, [hashtable]$History)
    $parts = @()
    $ptah = $false
    $cursor = $Process
    $visited = @{}
    for ($depth = 0; $depth -le 6 -and $null -ne $cursor; $depth++) {
        $cursorPid = [int]$cursor.ProcessId
        if ($visited.ContainsKey($cursorPid)) { break }
        $visited[$cursorPid] = $true
        $parts += ('{0}({1})' -f $cursor.Name, $cursorPid)
        if ($depth -gt 0) {
            if ($cursor.Name -in @('electron.exe', 'Ptah.exe', 'Code.exe')) {
                $ptah = $true
            } elseif ($cursor.Name -ieq 'node.exe' -and $cursor.CommandLine -match 'ptah') {
                $ptah = $true
            }
        }
        $parentPid = [int]$cursor.ParentProcessId
        if ($parentPid -le 0) { break }
        if ($Current.ContainsKey($parentPid)) {
            $cursor = $Current[$parentPid]
        } elseif ($History.ContainsKey($parentPid)) {
            $cursor = $History[$parentPid]
        } else {
            break
        }
    }
    return [pscustomobject]@{ Chain = ($parts -join ' <- '); Ptah = $ptah }
}

$windowCheckAvailable = $false
try {
    if (-not ('PtahConsoleWindowProbe' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PtahConsoleWindowProbe {
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);
    public static uint[] VisibleProcessIds() {
        HashSet<uint> ids = new HashSet<uint>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            if (IsWindowVisible(window)) {
                uint processId;
                GetWindowThreadProcessId(window, out processId);
                if (processId != 0) ids.Add(processId);
            }
            return true;
        }, IntPtr.Zero);
        uint[] result = new uint[ids.Count];
        ids.CopyTo(result);
        return result;
    }
}
'@ -ErrorAction Stop
    }
    $windowCheckAvailable = $true
} catch {
    Write-Warning "Visible-window detection unavailable: $($_.Exception.Message)"
}

$current = Get-ProcessSnapshot
$history = @{}
foreach ($key in $current.Keys) { $history[$key] = $current[$key] }
$pending = @()
$started = Get-Date

try {
    while ($true) {
        if ($DurationSeconds -gt 0 -and ((Get-Date) - $started).TotalSeconds -ge $DurationSeconds) { break }
        Start-Sleep -Milliseconds $IntervalMs
        try {
            $next = Get-ProcessSnapshot
        } catch {
            Write-Warning "Process polling failed: $($_.Exception.Message)"
            continue
        }

        $visible = @{}
        if ($windowCheckAvailable) {
            try {
                foreach ($visiblePid in [PtahConsoleWindowProbe]::VisibleProcessIds()) {
                    $visible[[int]$visiblePid] = $true
                }
            } catch {
                $windowCheckAvailable = $false
                Write-Warning "Visible-window detection stopped: $($_.Exception.Message)"
            }
        }

        foreach ($item in $pending) {
            $hasWindow = $visible.ContainsKey([int]$item.ProcessId)
            if (-not $hasWindow) {
                foreach ($child in $next.Values) {
                    if ($child.Name -in @('conhost.exe', 'OpenConsole.exe') -and
                        $child.ParentProcessId -eq $item.ProcessId -and
                        $visible.ContainsKey([int]$child.ProcessId)) {
                        $hasWindow = $true
                        break
                    }
                }
            }
            $flag = ''
            if ($hasWindow) { $flag = ' [VISIBLE-WINDOW]' }
            Write-Record ($item.Line + $flag)
        }
        $pending = @()

        foreach ($key in $next.Keys) {
            $process = $next[$key]
            if (-not $current.ContainsKey($key) -and (Test-NameMatch $process.Name)) {
                $ancestry = Get-Ancestry $process $next $history
                $command = ($process.CommandLine -replace '[\r\n\t]+', ' ').Trim()
                if ($command.Length -gt 300) { $command = $command.Substring(0, 300) }
                $marker = ''
                if ($ancestry.Ptah) { $marker = ' [PTAH]' }
                $line = '{0} PID={1} Name={2} CommandLine={3} Ancestors={4}{5}' -f `
                    (Get-Date -Format 'HH:mm:ss.fff'), $process.ProcessId, $process.Name, `
                    $command, $ancestry.Chain, $marker
                $pending += [pscustomobject]@{ ProcessId = $process.ProcessId; Line = $line }
            }
            $history[$key] = $process
        }
        $current = $next
    }
} finally {
    foreach ($item in $pending) { Write-Record $item.Line }
}
