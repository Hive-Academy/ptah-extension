import { win32 } from 'node:path';
import { CLAUDE_CERTIFIED_ENV_KEYS } from '@ptah-extension/agent-sdk';
import type { IProcessSpawner, SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { claudeAccountRouteGuard, claudeAccountRouteHolds } from './claude-account-command';
import type { ClaudeAuthContext } from './claude-route-certifier';

const LOGIN_ARGS = ['auth', 'login', '--claudeai'] as const;
const LOCAL_NO_PROXY = '127.0.0.1,localhost';
/** A posix name that `${NAME+...}` can reference. `PROGRAMFILES(X86)` is not one. */
const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** PowerShell treats these as single quotes too, so each is doubled inside a literal. */
const POWERSHELL_QUOTES = /['‘’‚‛]/g;

export type ClaudeLoginConsoleStart =
  | { readonly kind: 'started'; readonly child: SpawnedProcessHandle }
  | { readonly kind: 'unavailable' }
  /** The reserved route did not hold; no console started and no fallback may be offered. */
  | { readonly kind: 'route-changed' };

export interface ClaudeLoginFallbackScript {
  readonly dialect: 'powershell' | 'posix';
  /** Read-only text the user runs in their own terminal. Never run by Ptah. */
  readonly script: string;
}

/** Single-quoted PowerShell literal. */
export function quotePowerShell(value: string): string {
  return `'${value.replace(POWERSHELL_QUOTES, (quote) => quote + quote)}'`;
}

/** Single-quoted posix shell word. */
export function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * One argument quoted for `CommandLineToArgvW` (and the MSVC CRT): bare when it
 * has no blank or quote, else double-quoted with each quote escaped and the
 * backslashes in front of a quote or the closing quote doubled.
 */
export function quoteWindowsArgument(value: string): string {
  if (value !== '' && !/[\s"]/.test(value)) return value;
  let quoted = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === '\\') {
      slashes += 1;
      continue;
    }
    quoted += char === '"' ? `${'\\'.repeat(slashes * 2 + 1)}"` : `${'\\'.repeat(slashes)}${char}`;
    slashes = 0;
  }
  return `${quoted}${'\\'.repeat(slashes * 2)}"`;
}

/**
 * The hidden launcher's script. `Process.Start` with `UseShellExecute` opens the
 * target in a NEW visible console with no inherited std handles, so `claude`
 * sees a real terminal, and `WaitForExit` keeps this PowerShell (and so the
 * handle Ptah holds) alive until `claude` exits. The .NET `ProcessStartInfo`
 * form, not `Start-Process`: `Start-Process -WorkingDirectory` (and its `$PWD`
 * fallback) treats `[` and `]` as wildcards and fails before the child starts,
 * while `ProcessStartInfo` takes every path literally. `Arguments` is ONE
 * string, so the arguments are quoted for `CommandLineToArgvW`. Every value is
 * a single-quoted literal.
 */
function launcherScript(context: ClaudeAuthContext): string {
  const argumentLine = [...context.executable.prefixArgs, ...LOGIN_ARGS].map(quoteWindowsArgument).join(' ');
  return [
    "$ErrorActionPreference = 'Stop';",
    '$i = New-Object System.Diagnostics.ProcessStartInfo;',
    `$i.FileName = ${quotePowerShell(context.executable.command)};`,
    `$i.Arguments = ${quotePowerShell(argumentLine)};`,
    `$i.WorkingDirectory = ${quotePowerShell(context.cwd)};`,
    '$i.UseShellExecute = $true;',
    '$p = [System.Diagnostics.Process]::Start($i);',
    '$p.WaitForExit();',
    'exit $p.ExitCode',
  ].join(' ');
}

/** `-EncodedCommand` form: base64 of UTF-16LE, so no command-line quoting can reach the script. */
function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function envValue(env: Readonly<Record<string, string>>, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * The body runs in a child `powershell -NoProfile` process (script-block form,
 * which pwsh also accepts), so its `Remove-Item Env:` and `Set-Location` never
 * touch the user's own session. `exit $LASTEXITCODE` hands `claude`'s exit code
 * back to the user's `$LASTEXITCODE`.
 */
function powerShellScript(context: ClaudeAuthContext): string {
  const allow = CLAUDE_CERTIFIED_ENV_KEYS.map(quotePowerShell).join(', ');
  const dir = quotePowerShell(context.canonicalDir);
  const invocation = [context.executable.command, ...context.executable.prefixArgs].map(quotePowerShell).join(' ');
  return [
    'powershell -NoProfile -Command {',
    "$ErrorActionPreference = 'Stop';",
    `Set-Location -LiteralPath ${quotePowerShell(context.cwd)};`,
    `$allow = @(${allow});`,
    'Get-ChildItem Env: | Where-Object { $allow -notcontains $_.Name.ToUpperInvariant() } | Remove-Item;',
    `$env:NO_PROXY = if ($env:NO_PROXY) { "$env:NO_PROXY,${LOCAL_NO_PROXY}" } else { '${LOCAL_NO_PROXY}' };`,
    `$env:CLAUDE_CONFIG_DIR = ${dir};`,
    `$env:CLAUDE_SECURESTORAGE_CONFIG_DIR = ${dir};`,
    `& ${invocation} ${LOGIN_ARGS.join(' ')};`,
    'exit $LASTEXITCODE',
    '}',
  ].join(' ');
}

function posixScript(context: ClaudeAuthContext): string {
  const inherited: string[] = [];
  for (const upper of CLAUDE_CERTIFIED_ENV_KEYS) {
    if (upper === 'NO_PROXY' || !SHELL_NAME.test(upper)) continue;
    for (const name of new Set([upper, upper.toLowerCase()])) {
      inherited.push(`\${${name}+"${name}=$${name}"}`);
    }
  }
  const dir = quotePosix(context.canonicalDir);
  const invocation = [context.executable.command, ...context.executable.prefixArgs].map(quotePosix).join(' ');
  return [
    `( cd -- ${quotePosix(context.cwd)} && exec env -i`,
    ...inherited,
    `\${no_proxy+"no_proxy=$no_proxy,${LOCAL_NO_PROXY}"}`,
    `NO_PROXY="\${NO_PROXY:+$NO_PROXY,}${LOCAL_NO_PROXY}"`,
    `CLAUDE_CONFIG_DIR=${dir}`,
    `CLAUDE_SECURESTORAGE_CONFIG_DIR=${dir}`,
    invocation,
    `${LOGIN_ARGS.join(' ')} )`,
  ].join(' ');
}

/**
 * The user's own Claude sign-in (decisions.md D5): a visible console whose
 * output Ptah never reads, or a script for the user's terminal. Completion is
 * decided only by Ptah's status polls; nothing from this window is trusted.
 */
export class ClaudeLoginConsole {
  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly platform: NodeJS.Platform,
  ) {}

  /**
   * Starts a hidden, output-free Windows PowerShell (win32 only) that opens
   * `auth login --claudeai` in a new visible console and waits for it. The
   * returned child is that PowerShell; a tree kill of its pid also stops the
   * console and `claude`. (`conhost.exe` was not usable: libuv always passes
   * std handles, and `claude` given NUL handles quits at once.) The reserved
   * route is revalidated first (on every platform, so no fallback is offered
   * for a replaced directory) and its file identity guards creation.
   */
  async launch(context: ClaudeAuthContext, signal: AbortSignal): Promise<ClaudeLoginConsoleStart> {
    if (signal.aborted) return { kind: 'unavailable' };
    const route = context.route;
    if (!claudeAccountRouteHolds(route)) return { kind: 'route-changed' };
    if (this.platform !== 'win32') return { kind: 'unavailable' };
    const systemRoot = envValue(context.env, 'SYSTEMROOT');
    if (!systemRoot || !win32.isAbsolute(systemRoot)) return { kind: 'unavailable' };

    // No child started: a guard refusal and a route change found now both report route-changed.
    const notStarted = (): ClaudeLoginConsoleStart =>
      claudeAccountRouteHolds(route) ? { kind: 'unavailable' } : { kind: 'route-changed' };
    let child: SpawnedProcessHandle;
    try {
      child = this.spawner.spawnProcess({
        command: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(launcherScript(context))],
        env: context.env,
        cwd: context.cwd,
        // Hidden launcher, output never read (D5); the console it opens is the visible one.
        ignoreStdio: true,
        launchGuard: claudeAccountRouteGuard(route),
      });
    } catch {
      // degradation-audit: reported - a refused spawn starts no child; the caller offers the fallback script or refuses route-changed.
      return notStarted();
    }
    // `whenSpawned` resolves null when no child started (an `error` event follows).
    return (await child.whenSpawned) === null ? notStarted() : { kind: 'started', child };
  }

  /**
   * Read-only fallback text. It names only the context `cwd`, the canonical
   * directory, the executable and its prefix arguments; inherited env values
   * are referenced by name, never emitted.
   */
  fallbackScript(context: ClaudeAuthContext): ClaudeLoginFallbackScript {
    return this.platform === 'win32'
      ? { dialect: 'powershell', script: powerShellScript(context) }
      : { dialect: 'posix', script: posixScript(context) };
  }
}
