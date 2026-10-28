import 'reflect-metadata';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { buildCertifiedClaudeEnv, certifiedEnvDigest, CLAUDE_CERTIFIED_ENV_KEYS } from '@ptah-extension/agent-sdk';
import type { IProcessSpawner, ProcessSpawnRequest, SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { ClaudeLoginConsole, quotePosix, quotePowerShell, quoteWindowsArgument } from './claude-login-console';
import { ClaudeRouteCertifier, type ClaudeAuthContext, type ClaudeCliProbe, type ClaudeRouteCertifierFs } from './claude-route-certifier';
import { resolveProviderAccountRoute, type CanonicalProviderAccountRoute } from './provider-account-route';

const SDK_PATH = 'C:\\tools\\claude\\cli.js';

/** Ptah's own environment: inherited selectors and a proxy value that must never be emitted. */
const PTAH_ENV: Readonly<Record<string, string>> = {
  SystemRoot: 'C:\\Windows',
  Path: 'C:\\Windows\\System32',
  USERPROFILE: 'C:\\Users\\dev',
  ANTHROPIC_API_KEY: 'sk-ant-INHERITED-VALUE',
  CLAUDE_CODE_USE_BEDROCK: '1',
  AWS_PROFILE: 'corp-profile',
  NO_PROXY: 'corp',
};

function context(overrides: Partial<{ canonicalDir: string; cwd: string; command: string; prefixArgs: string[] }> = {}): ClaudeAuthContext {
  const canonicalDir = overrides.canonicalDir ?? 'C:\\Users\\dev\\.ptah\\claude-accounts\\acct-1';
  const env = buildCertifiedClaudeEnv(PTAH_ENV, canonicalDir);
  return {
    canonicalDir,
    cwd: overrides.cwd ?? canonicalDir,
    executable: {
      command: overrides.command ?? 'C:\\tools\\node.exe',
      prefixArgs: overrides.prefixArgs ?? [SDK_PATH],
      sdkExecutablePath: SDK_PATH,
      version: '2.1.310',
      fingerprint: { size: 1, mtimeMs: 1 },
    },
    env,
    envDigest: certifiedEnvDigest(env),
    policy: { coverage: 'win32@2.1.310', managedFile: 'absent', managedDropIn: 'absent', registry: 'absent', remoteSignals: 'absent' },
  };
}

function fakeChild(pid: number | null): SpawnedProcessHandle {
  return {
    stdin: null,
    stdout: null,
    stderr: null,
    whenSpawned: Promise.resolve(pid),
    pid: pid ?? undefined,
    killed: false,
    exitCode: null,
    kill: () => true,
    on: () => undefined,
    once: () => undefined,
    off: () => undefined,
  };
}

function fakeSpawner(pid: number | null = 4242): { spawner: IProcessSpawner; requests: ProcessSpawnRequest[] } {
  const requests: ProcessSpawnRequest[] = [];
  return {
    requests,
    spawner: {
      spawnProcess: (request) => {
        requests.push(request);
        return fakeChild(pid);
      },
    },
  };
}

const signal = (): AbortSignal => new AbortController().signal;

/** Reference parser: one PowerShell single-quoted literal at `text[start]`. */
function readPowerShellLiteral(text: string, start: number): string {
  expect(text[start]).toBe("'");
  let value = '';
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if ("'\u2018\u2019\u201A\u201B".includes(char)) {
      if ("'\u2018\u2019\u201A\u201B".includes(text[index + 1] ?? '')) {
        value += char;
        index += 1;
        continue;
      }
      return value;
    }
    value += char;
  }
  throw new Error('unterminated literal');
}

/** Reference parser: one posix word made of single-quoted segments and `\'`. */
function readPosixWord(text: string, start: number): string {
  let value = '';
  let index = start;
  while (index < text.length && text[index] !== ' ') {
    if (text[index] === "'") {
      const end = text.indexOf("'", index + 1);
      if (end < 0) throw new Error('unterminated word');
      value += text.slice(index + 1, end);
      index = end + 1;
    } else if (text.startsWith("\\'", index)) {
      value += "'";
      index += 2;
    } else {
      throw new Error(`unquoted character ${text[index]}`);
    }
  }
  return value;
}

function after(text: string, marker: string): number {
  const at = text.indexOf(marker);
  expect(at).toBeGreaterThanOrEqual(0);
  return at + marker.length;
}

/** The script a request carries after `-EncodedCommand` (base64 of UTF-16LE). */
function decodedScript(request: ProcessSpawnRequest | undefined): string {
  const args = request?.args ?? [];
  const encoded = args[args.indexOf('-EncodedCommand') + 1];
  if (encoded === undefined) throw new Error('no -EncodedCommand');
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

/** Code outside single-quoted literals, with each literal replaced by `''`. */
function scriptCode(script: string): string {
  let code = '';
  for (let index = 0; index < script.length; index += 1) {
    if ("'‘’‚‛".includes(script[index])) {
      const value = readPowerShellLiteral(script, index);
      index += quotePowerShell(value).length - 1;
      code += "''";
    } else {
      code += script[index];
    }
  }
  return code;
}

/** Reference parser: `CommandLineToArgvW` / MSVC CRT rules for arguments after the program name. */
function parseWindowsArguments(line: string): string[] {
  const parsed: string[] = [];
  let index = 0;
  while (index < line.length) {
    while (line[index] === ' ' || line[index] === '\t') index += 1;
    if (index >= line.length) break;
    let value = '';
    let inQuotes = false;
    while (index < line.length && (inQuotes || (line[index] !== ' ' && line[index] !== '\t'))) {
      const char = line[index];
      if (char === '\\') {
        let slashes = 0;
        while (line[index] === '\\') {
          slashes += 1;
          index += 1;
        }
        if (line[index] === '"') {
          value += '\\'.repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            value += '"';
            index += 1;
          }
        } else {
          value += '\\'.repeat(slashes);
        }
      } else if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          value += '"';
          index += 2;
        } else {
          inQuotes = !inQuotes;
          index += 1;
        }
      } else {
        value += char;
        index += 1;
      }
    }
    parsed.push(value);
  }
  return parsed;
}

describe('ClaudeLoginConsole.launch', () => {
  let root: string;
  let route: CanonicalProviderAccountRoute;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-login-console-'));
    mkdirSync(join(root, 'account'));
    route = resolveProviderAccountRoute(join(root, 'account'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  /** A context carrying the reserved route of a real temp directory. */
  const reserved = (): ClaudeAuthContext => ({ ...context({ canonicalDir: route.canonicalPath }), route });
  /** Moves the reserved directory away and puts a different directory at the same path. */
  const replaceDirectory = (): void => {
    renameSync(route.requestedPath, join(root, 'moved'));
    mkdirSync(route.requestedPath);
  };

  it('starts a hidden, output-free powershell.exe with the certified env, cwd and file-identity guard on win32', async () => {
    const { spawner, requests } = fakeSpawner();
    const ctx = reserved();
    const result = await new ClaudeLoginConsole(spawner, 'win32').launch(ctx, signal());

    expect(result.kind).toBe('started');
    expect(requests).toEqual([
      {
        command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', expect.stringMatching(/^[A-Za-z0-9+/]+=*$/)],
        env: ctx.env,
        cwd: ctx.canonicalDir,
        ignoreStdio: true,
        launchGuard: { fileIdentities: [{ path: route.requestedPath, realpath: route.canonicalPath,
          devIno: `${route.filesystemIdentity.volumeId}:${route.filesystemIdentity.fileId}` }] },
      },
    ]);
    // Never a visible host window: no userConsole, no needsConsole.
    expect(requests[0]).not.toHaveProperty('userConsole');
    expect(requests[0]).not.toHaveProperty('needsConsole');
  });

  it('the encoded script starts claude in a new console, waits, and hands back its exit code', async () => {
    const { spawner, requests } = fakeSpawner();
    const ctx = reserved();
    await new ClaudeLoginConsole(spawner, 'win32').launch(ctx, signal());
    const script = decodedScript(requests[0]);

    expect(script.startsWith(
      "$ErrorActionPreference = 'Stop'; $i = New-Object System.Diagnostics.ProcessStartInfo; $i.FileName = '")).toBe(true);
    expect(script.endsWith(
      '; $i.UseShellExecute = $true; $p = [System.Diagnostics.Process]::Start($i); $p.WaitForExit(); exit $p.ExitCode')).toBe(true);
    // No Start-Process (wildcard paths) and no WindowStyle (default Normal = visible console).
    expect(script).not.toContain('Start-Process');
    expect(script).not.toContain('WindowStyle');
    expect(readPowerShellLiteral(script, after(script, '$i.FileName = '))).toBe('C:\\tools\\node.exe');
    expect(parseWindowsArguments(readPowerShellLiteral(script, after(script, '$i.Arguments = '))))
      .toEqual([SDK_PATH, 'auth', 'login', '--claudeai']);
    expect(readPowerShellLiteral(script, after(script, '$i.WorkingDirectory = '))).toBe(ctx.cwd);
  });

  it.each([
    ['spaces', 'C:\\Program Files\\Claude Code\\claude.exe', ['C:\\Program Files\\cli dir\\cli.js'], 'C:\\Users\\Jane Doe\\work'],
    ['single quotes', "C:\\O'Brien\\claude.exe", ["C:\\it's\\cli.js", "'"], "C:\\it's here"],
    ['typographic quotes', 'C:\\a\u2019b\\claude.exe', ['\u2018x\u2019', '\u201Ay\u201B'], 'C:\\c\u2018d'],
    ['double quotes', 'C:\\x\\claude.exe', ['say "hi"', '"', 'a\\"b', 'end\\'], 'C:\\work'],
    ['shell metacharacters', 'C:\\a&b%PATH%$env:X\\claude.exe', ['a&b', '%USERPROFILE%', '$env:PATH', '$(Remove-Item x)', '`n;|<>^'], 'C:\\100%&$x'],
    ['trailing backslashes', 'C:\\x\\claude.exe', ['C:\\dir with space\\', 'C:\\plain\\', '\\\\', ''], 'C:\\work\\'],
    ['injection', "C:\\n'; Start-Process calc; '\\claude.exe", ["'; $i.FileName = 'x", '" & calc & "'], "C:\\w'; exit 1; '"],
    // Start-Process treated `[`/`]` as wildcards and failed before the child started.
    ['wildcard brackets and backticks', 'C:\\Users\\Jane[work] x\\`bin`\\claude.exe', ['C:\\a[1]`b\\cli.js', '[*]'], 'C:\\Users\\Jane[work] x\\it`s `$x'],
  ])('round-trips awkward values (%s) through the script literals and CommandLineToArgvW', async (_name, command, prefixArgs, cwd) => {
    const { spawner, requests } = fakeSpawner();
    const ctx: ClaudeAuthContext = { ...context({ canonicalDir: route.canonicalPath, command, prefixArgs, cwd }), route };
    await expect(new ClaudeLoginConsole(spawner, 'win32').launch(ctx, signal())).resolves.toEqual(expect.objectContaining({ kind: 'started' }));
    const script = decodedScript(requests[0]);

    expect(readPowerShellLiteral(script, after(script, '$i.FileName = '))).toBe(command);
    expect(parseWindowsArguments(readPowerShellLiteral(script, after(script, '$i.Arguments = '))))
      .toEqual([...prefixArgs, 'auth', 'login', '--claudeai']);
    expect(readPowerShellLiteral(script, after(script, '$i.WorkingDirectory = '))).toBe(cwd);
    // Outside the three literals the script is fixed code: nothing a value carries escapes them.
    expect(scriptCode(script)).toBe(
      "$ErrorActionPreference = ''; $i = New-Object System.Diagnostics.ProcessStartInfo; $i.FileName = ''; $i.Arguments = ''; " +
      "$i.WorkingDirectory = ''; $i.UseShellExecute = $true; $p = [System.Diagnostics.Process]::Start($i); $p.WaitForExit(); exit $p.ExitCode");
  });

  it.each([
    ['plain', 'a', 'a'],
    ['empty', '', '""'],
    ['space', 'a b', '"a b"'],
    ['tab', 'a\tb', '"a\tb"'],
    ['quote', 'a"b', '"a\\"b"'],
    ['backslash before quote', 'a\\"b', '"a\\\\\\"b"'],
    ['trailing backslash with space', 'a b\\', '"a b\\\\"'],
    ['backslashes not before a quote', 'C:\\x\\y', 'C:\\x\\y'],
  ])('quoteWindowsArgument: %s', (_name, value, expected) => {
    expect(quoteWindowsArgument(value)).toBe(expected);
    expect(parseWindowsArguments(quoteWindowsArgument(value))).toEqual([value]);
  });

  it.each(['win32', 'linux'] as const)('launches nothing against a directory replaced after reservation and coverage on %s',
    async (platform) => {
      const { spawner, requests } = fakeSpawner();
      const ctx = reserved();
      replaceDirectory();
      await expect(new ClaudeLoginConsole(spawner, platform).launch(ctx, signal())).resolves.toEqual({ kind: 'route-changed' });
      expect(requests).toEqual([]);
    });

  it('launches nothing without a reserved route', async () => {
    const { spawner, requests } = fakeSpawner();
    await expect(new ClaudeLoginConsole(spawner, 'win32').launch(context(), signal())).resolves.toEqual({ kind: 'route-changed' });
    expect(requests).toEqual([]);
  });

  it('reports route-changed when the guard refused the spawn because the directory changed', async () => {
    const spawner: IProcessSpawner = {
      spawnProcess: () => {
        // The spawner's creation-time check sees the replacement (simulated here).
        replaceDirectory();
        throw Object.assign(new Error('refused'), { code: 'ELAUNCHGUARD' });
      },
    };
    await expect(new ClaudeLoginConsole(spawner, 'win32').launch(reserved(), signal())).resolves.toEqual({ kind: 'route-changed' });
  });

  it.each(['darwin', 'linux'] as const)('spawns nothing on %s and returns unavailable', async (platform) => {
    const { spawner, requests } = fakeSpawner();
    await expect(new ClaudeLoginConsole(spawner, platform).launch(reserved(), signal())).resolves.toEqual({ kind: 'unavailable' });
    expect(requests).toEqual([]);
  });

  it('is unavailable when no child started', async () => {
    const { spawner } = fakeSpawner(null);
    await expect(new ClaudeLoginConsole(spawner, 'win32').launch(reserved(), signal())).resolves.toEqual({ kind: 'unavailable' });
  });

  it('is unavailable when the spawn throws', async () => {
    const spawner: IProcessSpawner = {
      spawnProcess: () => {
        throw Object.assign(new Error('refused'), { code: 'ELAUNCHGUARD' });
      },
    };
    await expect(new ClaudeLoginConsole(spawner, 'win32').launch(reserved(), signal())).resolves.toEqual({ kind: 'unavailable' });
  });

  it('is unavailable without SYSTEMROOT or after abort, with no spawn', async () => {
    const { spawner, requests } = fakeSpawner();
    const consoleWin = new ClaudeLoginConsole(spawner, 'win32');
    const ctx = reserved();
    const withoutRoot = { ...ctx, env: Object.fromEntries(Object.entries(ctx.env).filter(([key]) => key.toUpperCase() !== 'SYSTEMROOT')) };
    await expect(consoleWin.launch(withoutRoot, signal())).resolves.toEqual({ kind: 'unavailable' });
    const controller = new AbortController();
    controller.abort();
    await expect(consoleWin.launch(ctx, controller.signal)).resolves.toEqual({ kind: 'unavailable' });
    expect(requests).toEqual([]);
  });
});

describe('ClaudeLoginConsole.fallbackScript', () => {
  const powershell = new ClaudeLoginConsole(fakeSpawner().spawner, 'win32');
  const posix = new ClaudeLoginConsole(fakeSpawner().spawner, 'linux');

  it('PowerShell: the first statement changes to the context cwd inside a Stop script block of a child process', () => {
    const ctx = context();
    const { dialect, script } = powershell.fallbackScript(ctx);
    expect(dialect).toBe('powershell');
    expect(script.startsWith("powershell -NoProfile -Command { $ErrorActionPreference = 'Stop'; Set-Location -LiteralPath ")).toBe(true);
    expect(readPowerShellLiteral(script, after(script, 'Set-Location -LiteralPath '))).toBe(ctx.cwd);
    expect(script.endsWith('auth login --claudeai; exit $LASTEXITCODE }')).toBe(true);
  });

  it.each([
    ['plain', context()],
    ['injection', context({ canonicalDir: "C:\\x' }; Remove-Item Env:PATH; & { '", command: "C:\\n'; Set-Location C:\\; '\\node.exe" })],
  ] as const)('PowerShell (%s): the env clearing and Set-Location run only inside the child block', (_label, ctx) => {
    const code = scriptCode(powershell.fallbackScript(ctx).script);
    const prefix = 'powershell -NoProfile -Command {';
    expect(code.startsWith(prefix)).toBe(true);
    expect(code.endsWith(' }')).toBe(true);
    // The block opened by the prefix closes only at the last character.
    let depth = 0;
    for (let index = prefix.length - 1; index < code.length; index += 1) {
      if (code[index] === '{') depth += 1;
      if (code[index] === '}') depth -= 1;
      if (depth === 0) expect(index).toBe(code.length - 1);
    }
    expect(depth).toBe(0);
    const body = code.slice(prefix.length, -1);
    for (const sideEffect of ['Set-Location', 'Remove-Item', '$env:CLAUDE_CONFIG_DIR', '$env:NO_PROXY', 'exit $LASTEXITCODE']) {
      expect(body).toContain(sideEffect);
    }
    expect(code.match(/Remove-Item/g)).toHaveLength(1);
    expect(code.match(/Set-Location/g)).toHaveLength(1);
  });

  it('posix: the first step is cd inside a subshell, chained with &&', () => {
    const ctx = context({ canonicalDir: '/home/dev/.ptah/claude-accounts/acct-1' });
    const { dialect, script } = posix.fallbackScript(ctx);
    expect(dialect).toBe('posix');
    expect(script.startsWith("( cd -- '")).toBe(true);
    expect(readPosixWord(script, after(script, 'cd -- '))).toBe(ctx.cwd);
    expect(script).toContain(' && exec env -i ');
    expect(script.endsWith('auth login --claudeai )')).toBe(true);
  });

  it('started from a different workspace with an apiKeyHelper, the script names only the scanned cwd', async () => {
    const workspace = join(tmpdir(), 'ptah-other-workspace');
    const workspaceSettings = win32.join(workspace, '.claude', 'settings.json');
    const canonicalDir = join(tmpdir(), 'ptah-account-dir');
    const reads: string[] = [];
    const files = new Map([[workspaceSettings, JSON.stringify({ apiKeyHelper: 'C:\\evil\\helper.cmd' })]]);
    const enoent = (): never => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    };
    const fs: ClaudeRouteCertifierFs = {
      readFile: async (path) => {
        reads.push(path);
        return files.get(path) ?? enoent();
      },
      lstat: async () => enoent(),
      readdir: async () => enoent(),
      stat: async () => ({ size: 1, mtimeMs: 1 }),
    };
    const probe: ClaudeCliProbe = {
      certifyExecutable: async () => ({ ok: true, terminated: true, executable: context().executable }),
      status: async () => ({ status: null, terminated: true }),
      logout: async () => ({ exitCode: 0, terminated: true }),
      queryRegistry: async (path) => ({
        exitCode: 0, stdout: path.replace(/^HKLM/, 'HKEY_LOCAL_MACHINE').replace(/^HKCU/, 'HKEY_CURRENT_USER'),
        terminated: true, timedOut: false, overflow: false,
      }),
    };
    const route = { requestedPath: canonicalDir, canonicalPath: canonicalDir, filesystemIdentity: { volumeId: '1', fileId: '2' }, fingerprint: 'f' };
    const auth = await new ClaudeRouteCertifier(probe, 'win32', fs).authContext({ route, signal: signal() });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    const { script } = powershell.fallbackScript(auth.context);
    const scriptCwd = readPowerShellLiteral(script, after(script, 'Set-Location -LiteralPath '));
    expect(reads).toContain(win32.join(scriptCwd, '.claude', 'settings.json'));
    expect(reads).not.toContain(workspaceSettings);
    expect(script).not.toContain(workspace);
    expect(script).not.toContain('helper.cmd');
  });

  it.each([
    ['powershell', powershell],
    ['posix', posix],
  ] as const)('%s: emits no inherited value, allowlist names by reference only, and no selector', (_label, loginConsole) => {
    const { script } = loginConsole.fallbackScript(context());
    // Inherited values: the API key, the AWS profile, the proxy value and SystemRoot/Path.
    for (const value of ['sk-ant-INHERITED-VALUE', 'corp', 'C:\\Windows']) {
      expect(script).not.toContain(value);
    }
    for (const selector of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE']) {
      expect(script).not.toContain(selector);
    }
    expect(script).toContain('127.0.0.1,localhost');
  });

  it('posix references each allowlist name and its lower-case variant without a value', () => {
    const { script } = posix.fallbackScript(context());
    for (const name of CLAUDE_CERTIFIED_ENV_KEYS.filter((key) => /^[A-Z_][A-Z0-9_]*$/.test(key) && key !== 'NO_PROXY')) {
      expect(script).toContain(`\${${name}+"${name}=$${name}"}`);
      const lower = name.toLowerCase();
      expect(script).toContain(`\${${lower}+"${lower}=$${lower}"}`);
    }
    expect(script).toContain('${no_proxy+"no_proxy=$no_proxy,127.0.0.1,localhost"}');
    expect(script).toContain('NO_PROXY="${NO_PROXY:+$NO_PROXY,}127.0.0.1,localhost"');
    expect(script).not.toContain('PROGRAMFILES(X86)');
  });

  it('PowerShell keeps exactly the allowlist names as literals', () => {
    const { script } = powershell.fallbackScript(context());
    expect(script).toContain(`$allow = @(${CLAUDE_CERTIFIED_ENV_KEYS.map((key) => `'${key}'`).join(', ')});`);
    expect(script).toContain('Where-Object { $allow -notcontains $_.Name.ToUpperInvariant() } | Remove-Item;');
  });

  const awkward = "C:\\Users\\Dev O'Brien\\$HOME `tick`; rm -rf ‘x’";
  it.each([
    ['powershell', powershell, readPowerShellLiteral],
    ['posix', posix, readPosixWord],
  ] as const)('%s: paths with spaces and metacharacters round-trip', (_label, loginConsole, read) => {
    const ctx = context({
      canonicalDir: `${awkward}\\profile dir`,
      command: `${awkward}\\node.exe`,
      prefixArgs: [`${awkward}\\cli.js`, "--flag='x'"],
    });
    const { script } = loginConsole.fallbackScript(ctx);
    const cwdMarker = loginConsole === powershell ? 'Set-Location -LiteralPath ' : 'cd -- ';
    const dirMarker = loginConsole === powershell ? '$env:CLAUDE_CONFIG_DIR = ' : 'CLAUDE_CONFIG_DIR=';
    expect(read(script, after(script, cwdMarker))).toBe(ctx.cwd);
    expect(read(script, after(script, dirMarker))).toBe(ctx.canonicalDir);

    const invocationMarker = loginConsole === powershell ? `${quotePowerShell(ctx.canonicalDir)}; & ` : `CLAUDE_SECURESTORAGE_CONFIG_DIR=${quotePosix(ctx.canonicalDir)} `;
    let at = after(script, invocationMarker);
    const words: string[] = [];
    const quote = loginConsole === powershell ? quotePowerShell : quotePosix;
    for (const expected of [ctx.executable.command, ...ctx.executable.prefixArgs]) {
      const word = read(script, at);
      words.push(word);
      at += quote(word).length + 1;
      expect(word).toBe(expected);
    }
    expect(script.slice(at)).toMatch(/^auth login --claudeai/);
  });
});
