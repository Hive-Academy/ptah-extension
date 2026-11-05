import { execFile } from 'node:child_process';
import { join, normalize, resolve } from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';

export const CODEX_WRITE_DAC_TIMEOUT_MS = 30_000;

export class CodexLaneWriteDacDeniedError extends Error {
  constructor(cwd: string) {
    super(`Codex cannot prepare workspace-write for ${cwd}: WRITE_DAC is denied, so Codex cannot add its capability ACE. Use a current-user-owned worktree, or follow the elevated owner-repair documentation. No ACL was changed. The lane may still work if the Codex capability ACE already exists on this folder; set PTAH_CODEX_SKIP_WRITE_DAC_PREFLIGHT=1 to skip this check.`);
    this.name = 'CodexLaneWriteDacDeniedError';
  }
}

export interface WriteDacProbeRunner {
  run(encodedCommand: string): Promise<string>;
}

const nativeRunner: WriteDacProbeRunner = {
  run: (encodedCommand) => new Promise<string>((resolveOutput, reject) => {
    const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = execFile(powershell, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encodedCommand],
      { timeout: CODEX_WRITE_DAC_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
        if (error) reject(error);
        else resolveOutput(stdout);
      });
    // degradation-audit: reported - a stdin EPIPE (child already exited) must not
    // become an unhandled 'error' event; the exec callback reports the outcome.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end();
  }),
};

function commandFor(cwd: string): string {
  // The path is data inside the encoded script, never shell syntax or an argument parsed by PowerShell.
  const pathBase64 = Buffer.from(cwd, 'utf16le').toString('base64');
  const script = `$path = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${pathBase64}'))
try {
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $owner = (New-Object System.IO.DirectoryInfo $path).GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner).GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($owner -eq $me) { [Console]::Out.WriteLine(0); exit 0 }
} catch {
  # Ownership lookup failed; the CreateFileW probe below remains authoritative.
}
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class PtahWriteDacProbe {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
  public static int Probe(string path) {
    IntPtr handle = CreateFileW(path, 0x00040000, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle == new IntPtr(-1)) return Marshal.GetLastWin32Error();
    CloseHandle(handle);
    return 0;
  }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp -ErrorAction Stop
[Console]::Out.WriteLine([PtahWriteDacProbe]::Probe($path))
`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

export class CodexLaneWriteDacPreflight {
  private readonly decisions = new Map<string, Promise<number | undefined>>();
  private skipReported = false;
  constructor(
    private readonly logger: Logger,
    private readonly runner: WriteDacProbeRunner = nativeRunner,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async check(cwd: string, sandboxMode: string): Promise<void> {
    if (this.platform !== 'win32' || sandboxMode !== 'workspace-write') return;
    if (process.env['PTAH_CODEX_SKIP_WRITE_DAC_PREFLIGHT'] === '1') {
      if (!this.skipReported) {
        this.logger.info('[CodexLaneWriteDacPreflight] WRITE_DAC probe skipped by environment');
        this.skipReported = true;
      }
      return;
    }
    const normalized = normalize(resolve(cwd));
    const key = normalized.toLowerCase();
    let pending = this.decisions.get(key);
    if (!pending) {
      pending = this.probe(normalized);
      this.decisions.set(key, pending);
      void pending.then((result) => {
        if (result !== 0 && this.decisions.get(key) === pending) this.decisions.delete(key);
      }, () => {
        if (this.decisions.get(key) === pending) this.decisions.delete(key);
      });
    }
    const result = await pending;
    if (result === 5) throw new CodexLaneWriteDacDeniedError(normalized);
  }

  private async probe(cwd: string): Promise<number | undefined> {
    const started = Date.now();
    try {
      const output = (await this.runner.run(commandFor(cwd))).trim();
      if (!/^\d+$/.test(output)) {
        this.warn('unparseable-output', started);
        return undefined;
      }
      const result = Number(output);
      if (result !== 0 && result !== 5) this.warn('unexpected-code', started, { code: result });
      return result;
    } catch (error: unknown) {
      // degradation-audit: reported - an inconclusive helper failure must not block the lane.
      const detail = error !== null && typeof error === 'object' ? error : {};
      const code = 'code' in detail && (typeof detail.code === 'string' || typeof detail.code === 'number') ? detail.code : undefined;
      const signal = 'signal' in detail && typeof detail.signal === 'string' ? detail.signal : undefined;
      const killed = 'killed' in detail && typeof detail.killed === 'boolean' ? detail.killed : undefined;
      this.warn(killed === true || signal === 'SIGTERM' || code === 'ETIMEDOUT' ? 'timeout' : 'spawn-failed', started,
        { code, signal, killed });
      return undefined;
    }
  }

  private warn(outcome: 'timeout' | 'spawn-failed' | 'unexpected-code' | 'unparseable-output',
    started: number, detail: { code?: string | number; signal?: string; killed?: boolean } = {}): void {
    this.logger.warn('[CodexLaneWriteDacPreflight] WRITE_DAC probe inconclusive', {
      outcome, elapsedMs: Date.now() - started, ...detail,
    });
  }
}
