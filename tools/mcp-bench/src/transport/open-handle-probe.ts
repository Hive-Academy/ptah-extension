/**
 * Which processes hold which files open, read from outside those processes.
 *
 * The real-state guard asks two questions:
 *
 * - {@link HandleProbe.holders}: which processes hold these few paths (the
 *   real database files) open? A holder other than the bench is a concurrent
 *   writer.
 * - {@link HandleProbe.treeOpenPaths}: which paths does a process tree (the
 *   bench host and its descendants) hold open? process-watch looks for one
 *   under the real `~/.ptah`.
 *
 * Platforms:
 *
 * - win32: one Windows PowerShell run per question, the C# below compiled by
 *   `Add-Type` (about one second). `holders` opens each path with
 *   `FILE_READ_ATTRIBUTES` only and full sharing (no data is read, nothing is
 *   written) and asks `NtQueryInformationFile(FileProcessIdsUsingFileInformation)`,
 *   the source the Restart Manager reads. `treeOpenPaths` walks the system
 *   handle table (`NtQuerySystemInformation(SystemExtendedHandleInformation)`)
 *   for the tree's pids, duplicates each handle into the probe (the tree runs
 *   as this user, so `PROCESS_DUP_HANDLE` is granted) and names disk files with
 *   `GetFinalPathNameByHandleW`. A query on a synchronous pipe can block behind
 *   a pending read, so each handle is named on a worker that is abandoned
 *   after a short timeout, and that handle counts as `unprobed`. The process
 *   table comes from `Win32_Process`.
 * - linux: `/proc/<pid>/fd/*` and `/proc/<pid>/cwd` links, for every process
 *   this user can read (the desktop app and the bench both run as this user).
 * - any other platform: no probe ({@link platformHandleProbe} returns `null`).
 *   The caller falls back to what it can do without one and says so.
 *
 * Paths are passed on stdin as JSON, never on a command line.
 */

import { spawn } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
}

export interface HoldersResult {
  /** Probed path → ids of the processes holding it. Free paths are absent. */
  readonly holders: ReadonlyMap<string, readonly number[]>;
  readonly processes: readonly ProcessEntry[];
}

export interface OpenPath {
  readonly pid: number;
  /** Absolute path, without the `\\?\` prefix win32 reports. */
  readonly path: string;
}

export interface TreeOpenPathsResult {
  /** The root and its descendants that were alive at the sample. */
  readonly tree: readonly ProcessEntry[];
  readonly open: readonly OpenPath[];
  /** Handles (or whole processes) the probe could not name. */
  readonly unprobed: number;
}

export interface HandleProbe {
  readonly platform: NodeJS.Platform;
  holders(paths: readonly string[]): Promise<HoldersResult>;
  treeOpenPaths(rootPid: number): Promise<TreeOpenPathsResult>;
}

/** The probe for this platform, or `null` where open handles cannot be listed. */
export function platformHandleProbe(
  platform: NodeJS.Platform = process.platform,
): HandleProbe | null {
  if (platform === 'win32') return new WindowsHandleProbe();
  if (platform === 'linux') return new ProcFsHandleProbe();
  return null;
}

/** `root` and every process descending from it, as far as `processes` shows. */
export function processTree(
  rootPid: number,
  processes: readonly ProcessEntry[],
): Set<number> {
  const children = new Map<number, number[]>();
  for (const entry of processes) {
    // A pid that names itself as parent (the idle/system entries) is no tree.
    if (entry.pid === entry.ppid) continue;
    const siblings = children.get(entry.ppid) ?? [];
    siblings.push(entry.pid);
    children.set(entry.ppid, siblings);
  }
  const tree = new Set<number>([rootPid]);
  const pending = [rootPid];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    for (const child of children.get(pid) ?? []) {
      if (tree.has(child)) continue;
      tree.add(child);
      pending.push(child);
    }
  }
  return tree;
}

/** `\\?\C:\x` → `C:\x`, `\\?\UNC\srv\share` → `\\srv\share`. */
export function stripWin32DevicePrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`;
  if (path.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}

const PROBE_TIMEOUT_MS = 60_000;
const PER_HANDLE_TIMEOUT_MS = 250;

/** Written for the C# 5 compiler Windows PowerShell 5.1 ships with. */
const WINDOWS_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
public static class PtahBenchProbe {
  [StructLayout(LayoutKind.Sequential)]
  private struct IoStatusBlock { public IntPtr Status; public IntPtr Information; }
  [StructLayout(LayoutKind.Sequential)]
  private struct HandleEntry {
    public IntPtr Object; public IntPtr UniqueProcessId; public IntPtr HandleValue;
    public uint GrantedAccess; public ushort CreatorBackTraceIndex; public ushort ObjectTypeIndex;
    public uint HandleAttributes; public uint Reserved;
  }
  [DllImport("ntdll.dll")] private static extern int NtQueryInformationFile(SafeFileHandle handle, out IoStatusBlock io, IntPtr info, int length, int infoClass);
  [DllImport("ntdll.dll")] private static extern int NtQuerySystemInformation(int infoClass, IntPtr info, int length, out int returned);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr sourceHandle, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] private static extern uint GetFileType(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandleW(IntPtr handle, StringBuilder path, uint length, uint flags);

  // FILE_READ_ATTRIBUTES, share read|write|delete, OPEN_EXISTING, backup
  // semantics (a directory opens too); class 47 is
  // FileProcessIdsUsingFileInformation. null: the path could not be queried.
  public static long[] Holders(string path) {
    SafeFileHandle handle = CreateFileW(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle.IsInvalid) { return null; }
    try {
      int size = 4096;
      while (size <= (1 << 22)) {
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
          IoStatusBlock io;
          int status = NtQueryInformationFile(handle, out io, buffer, size, 47);
          if (status == unchecked((int)0xC0000004) || status == unchecked((int)0x80000005)) { size *= 4; continue; }
          if (status != 0) { return null; }
          int count = Marshal.ReadInt32(buffer);
          long[] pids = new long[count];
          for (int i = 0; i < count; i++) { pids[i] = Marshal.ReadIntPtr(buffer, IntPtr.Size + i * IntPtr.Size).ToInt64(); }
          return pids;
        } finally { Marshal.FreeHGlobal(buffer); }
      }
      return null;
    } finally { handle.Dispose(); }
  }

  public static int Unprobed;

  // Class 64 is SystemExtendedHandleInformation; 0x40 PROCESS_DUP_HANDLE;
  // 2 DUPLICATE_SAME_ACCESS; file type 1 FILE_TYPE_DISK.
  public static List<string> OpenPaths(long[] pids, int perHandleTimeoutMs) {
    Unprobed = 0;
    HashSet<long> wanted = new HashSet<long>(pids);
    List<string> found = new List<string>();
    int size = 1 << 22;
    IntPtr buffer;
    while (true) {
      buffer = Marshal.AllocHGlobal(size);
      int returned;
      int status = NtQuerySystemInformation(64, buffer, size, out returned);
      if (status == unchecked((int)0xC0000004)) { Marshal.FreeHGlobal(buffer); size = Math.Max(size * 2, returned + (1 << 20)); continue; }
      if (status != 0) { Marshal.FreeHGlobal(buffer); throw new Exception("NtQuerySystemInformation 0x" + status.ToString("X8")); }
      break;
    }
    Dictionary<long, IntPtr> processes = new Dictionary<long, IntPtr>();
    try {
      long count = Marshal.ReadIntPtr(buffer).ToInt64();
      int entrySize = Marshal.SizeOf(typeof(HandleEntry));
      long start = buffer.ToInt64() + 2 * IntPtr.Size;
      for (long i = 0; i < count; i++) {
        HandleEntry entry = (HandleEntry)Marshal.PtrToStructure(new IntPtr(start + i * entrySize), typeof(HandleEntry));
        long pid = entry.UniqueProcessId.ToInt64();
        if (!wanted.Contains(pid)) continue;
        IntPtr process;
        if (!processes.TryGetValue(pid, out process)) {
          process = OpenProcess(0x40, false, (int)pid);
          processes[pid] = process;
          if (process == IntPtr.Zero) { Unprobed++; }
        }
        if (process == IntPtr.Zero) continue;
        IntPtr dup;
        if (!DuplicateHandle(process, entry.HandleValue, GetCurrentProcess(), out dup, 0, false, 2)) continue;
        string path = null;
        IntPtr captured = dup;
        Thread worker = new Thread(delegate () {
          if (GetFileType(captured) != 1) return;
          StringBuilder name = new StringBuilder(2048);
          uint length = GetFinalPathNameByHandleW(captured, name, 2048, 0);
          if (length > 0 && length < 2048) path = name.ToString();
        });
        worker.IsBackground = true;
        worker.Start();
        if (!worker.Join(perHandleTimeoutMs)) { Unprobed++; continue; }
        CloseHandle(dup);
        if (path != null) found.Add(pid + "\t" + path);
      }
    } finally {
      foreach (IntPtr process in processes.Values) { if (process != IntPtr.Zero) CloseHandle(process); }
      Marshal.FreeHGlobal(buffer);
    }
    return found;
  }
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$processes = New-Object System.Collections.ArrayList
foreach ($p in Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name) {
  [void]$processes.Add(@{ pid = [long]$p.ProcessId; ppid = [long]$p.ParentProcessId; name = [string]$p.Name })
}
$out = @{ processes = $processes.ToArray() }
if ($request.mode -eq 'holders') {
  $holders = New-Object System.Collections.ArrayList
  foreach ($path in @($request.paths)) {
    $pids = [PtahBenchProbe]::Holders([string]$path)
    if (($null -ne $pids) -and ($pids.Length -gt 0)) { [void]$holders.Add(@{ path = [string]$path; pids = @($pids) }) }
  }
  $out.holders = $holders.ToArray()
} else {
  $tree = New-Object 'System.Collections.Generic.HashSet[long]'
  [void]$tree.Add([long]$request.rootPid)
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($p in $processes) {
      if (($p.pid -ne $p.ppid) -and $tree.Contains($p.ppid) -and $tree.Add($p.pid)) { $grew = $true }
    }
  }
  $open = [PtahBenchProbe]::OpenPaths([long[]]@($tree), [int]$request.perHandleTimeoutMs)
  $out.open = @($open)
  $out.unprobed = [PtahBenchProbe]::Unprobed
}
[Console]::Out.Write((ConvertTo-Json -Compress -Depth 4 -InputObject $out))
`;

class WindowsHandleProbe implements HandleProbe {
  readonly platform = 'win32' as const;

  async holders(paths: readonly string[]): Promise<HoldersResult> {
    const reply = parseReply(await runWindowsProbe({ mode: 'holders', paths }));
    const holders = new Map<string, number[]>();
    for (const item of asList(reply['holders'])) {
      const entry = item as Record<string, unknown>;
      const pids = asList(entry['pids']).filter(
        (pid): pid is number => typeof pid === 'number',
      );
      if (typeof entry['path'] === 'string' && pids.length > 0) {
        holders.set(entry['path'], pids);
      }
    }
    return { holders, processes: parseProcesses(reply['processes']) };
  }

  async treeOpenPaths(rootPid: number): Promise<TreeOpenPathsResult> {
    const reply = parseReply(
      await runWindowsProbe({
        mode: 'tree',
        rootPid,
        perHandleTimeoutMs: PER_HANDLE_TIMEOUT_MS,
      }),
    );
    const processes = parseProcesses(reply['processes']);
    const treePids = processTree(rootPid, processes);
    const open = asList(reply['open']).flatMap((line): OpenPath[] => {
      if (typeof line !== 'string') return [];
      const tab = line.indexOf('\t');
      const pid = Number(line.slice(0, tab));
      return tab > 0 && Number.isInteger(pid)
        ? [{ pid, path: stripWin32DevicePrefix(line.slice(tab + 1)) }]
        : [];
    });
    return {
      tree: processes.filter((entry) => treePids.has(entry.pid)),
      open,
      unprobed: typeof reply['unprobed'] === 'number' ? reply['unprobed'] : 0,
    };
  }
}

function runWindowsProbe(request: Record<string, unknown>): Promise<string> {
  return runCaptured(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(WINDOWS_PROBE_SCRIPT, 'utf16le').toString('base64'),
    ],
    JSON.stringify(request),
  );
}

function parseReply(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `open-handle probe returned no JSON: ${stdout.slice(0, 200)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('open-handle probe returned a non-object');
  }
  return parsed as Record<string, unknown>;
}

/** ConvertTo-Json may collapse a one-element array; accept both forms. */
function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function parseProcesses(value: unknown): ProcessEntry[] {
  return asList(value).flatMap((item): ProcessEntry[] => {
    const entry = item as Record<string, unknown>;
    return typeof entry['pid'] === 'number' && typeof entry['ppid'] === 'number'
      ? [
          {
            pid: entry['pid'],
            ppid: entry['ppid'],
            name: String(entry['name'] ?? ''),
          },
        ]
      : [];
  });
}

class ProcFsHandleProbe implements HandleProbe {
  readonly platform = 'linux' as const;

  async holders(paths: readonly string[]): Promise<HoldersResult> {
    const wanted = new Set(paths.map((path) => resolve(path)));
    const processes = await readProcessTable();
    const holders = new Map<string, number[]>();
    for (const { pid } of processes) {
      for (const target of await openTargets(pid)) {
        if (!wanted.has(target)) continue;
        const holding = holders.get(target) ?? [];
        if (!holding.includes(pid)) holding.push(pid);
        holders.set(target, holding);
      }
    }
    return { holders, processes };
  }

  async treeOpenPaths(rootPid: number): Promise<TreeOpenPathsResult> {
    const processes = await readProcessTable();
    const treePids = processTree(rootPid, processes);
    const tree = processes.filter((entry) => treePids.has(entry.pid));
    const open: OpenPath[] = [];
    for (const { pid } of tree) {
      for (const path of await openTargets(pid)) open.push({ pid, path });
    }
    // An unreadable fd table belongs to another user; the tree is this user's.
    return { tree, open, unprobed: 0 };
  }
}

async function readProcessTable(): Promise<ProcessEntry[]> {
  const pids = (await readdir('/proc'))
    .filter((name) => /^\d+$/.test(name))
    .map(Number);
  const entries = await Promise.all(pids.map(readProcStat));
  return entries.filter((entry): entry is ProcessEntry => entry !== null);
}

async function readProcStat(pid: number): Promise<ProcessEntry | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // `pid (comm) state ppid …` — comm may contain spaces and parentheses.
    const open = stat.indexOf('(');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    return { pid, ppid: Number(fields[1]), name: stat.slice(open + 1, close) };
  } catch {
    return null; // exited between the listing and the read
  }
}

async function openTargets(pid: number): Promise<string[]> {
  const links: string[] = [`/proc/${pid}/cwd`];
  try {
    for (const fd of await readdir(`/proc/${pid}/fd`)) {
      links.push(`/proc/${pid}/fd/${fd}`);
    }
  } catch {
    // Another user's process, or it exited: nothing this user can see.
  }
  const targets = await Promise.all(
    links.map((link) => readlink(link).catch(() => null)),
  );
  return targets.filter(
    (target): target is string => target !== null && target.startsWith('/'),
  );
}

function runCaptured(
  command: string,
  args: readonly string[],
  stdin: string,
): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2_000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(`open-handle probe timed out after ${PROBE_TIMEOUT_MS} ms`),
      );
    }, PROBE_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) done(stdout);
      else
        reject(new Error(`open-handle probe exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(stdin);
  });
}
