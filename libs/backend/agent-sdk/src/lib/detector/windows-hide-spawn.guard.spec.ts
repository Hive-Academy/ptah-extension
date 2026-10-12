/**
 * Source guard: every production child-process spawn must set `windowsHide`.
 *
 * WHY. Electron's main process and its `utilityProcess` workers own no
 * console. On Windows, each console-subsystem child (`git.exe`, `taskkill.exe`,
 * `ffmpeg`, `cmd.exe` for `.cmd` shims, ...) started without
 * `windowsHide: true` gets a NEW, VISIBLE console that closes when the child
 * exits — the "console windows flash open and closed" symptom
 * (TASK_2026_625). Most spawns route through `OffThreadProcessSpawner`, which
 * hides the window unless the caller asks for `needsConsole`. The sites this
 * guard scans bypass it, so each must state the flag itself.
 *
 * WHAT PASSES. The `windowsHide` key in the call's arguments, with any value.
 * A computed value is accepted on purpose: `spawnCli` and the off-thread
 * spawner set `windowsHide: !needsConsole`, because CLIs that run shell tools
 * through ConPTY (Copilot, Antigravity) need a real console — ConPTY's
 * AttachConsole() fails without one. Those runs keep a VISIBLE window. The
 * options and the manual check that decides between them are in the task
 * folder (`.ptah/specs/TASK_2026_625_99ae/context.md`, `## Decisions`).
 *
 * THIRD-PARTY SPAWNS (not scanned, `node_modules` is excluded): the
 * `@openai/codex-sdk` `codex exec` per turn, the `@cursor/sdk` local runtime
 * (git, shell tool, ffmpeg) and `chrome-launcher`'s `taskkill` on browser
 * close have no spawn hook. The postinstall script
 * `scripts/windows-hide-patch/patch-windows-hide-deps.js` patches them, and
 * its spec fails when a dependency bump no longer matches the patch.
 *
 * KNOWN LIMIT: an options object built in a separate statement and passed by
 * name is not seen, and fails this guard. Inline the options, or add the key
 * at the call.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Repo root: this file lives at libs/backend/agent-sdk/src/lib/detector/. */
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

/**
 * Production trees that may spawn processes on Windows. A file is scanned only
 * if it names `child_process` or `cross-spawn`, which keeps unrelated calls
 * such as `regex.exec(...)` out.
 */
const SCAN_ROOTS = [
  'libs/backend',
  'apps/ptah-cli/src',
  'apps/ptah-extension-vscode/src',
  'apps/ptah-electron/src',
  'apps/ptah-tui/src',
];

/**
 * Test-only code that never runs inside a shipped host. The RSS sampler is the
 * child process of `workspace-watch-host.stress.harness.ts`.
 */
const EXCLUDED_PATH =
  /(?:[\\/](?:node_modules|dist|testing|test-utils|__fixtures__)[\\/])|\.spec\.|\.harness\.|\.d\.ts$|workspace-watch-host-rss-sampler\.js$/;

const SPAWN_MODULE = /['"](?:node:)?child_process['"]|['"]cross-spawn['"]/;

/**
 * The spawn family, called bare or as a member (`cp.spawn`, `crossSpawn.sync`,
 * `crossSpawn.default`), plus the injected forms this repo uses
 * (`this.spawnFn`, `this.spawner`) and promisified `execFileAsync`.
 */
const CALL_START =
  /(?<![\w$])(?:[\w$]+\.)*(spawn|spawnSync|execFile|execFileSync|execFileAsync|fork|crossSpawn|spawnFn|spawner|sync|default)\s*\(/g;

/** `.sync(` / `.default(` count only when called on cross-spawn. */
const CROSS_SPAWN_MEMBER = /crossSpawn\w*\.(?:sync|default)\s*\($/;

const WINDOWS_HIDE_KEY = /(?:^|[^\w.$])windowsHide\s*:/;

interface Offender {
  readonly file: string;
  readonly line: number;
  readonly call: string;
}

/**
 * Replace comments with spaces (newlines kept, so line numbers stay true).
 * Quote-aware, so a `//` inside a URL string is not taken as a comment.
 */
function blankComments(source: string): string {
  let out = '';
  let quote: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      out += source[i] ?? '';
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Split a call's arguments at bracket depth zero, starting just after its open
 * parenthesis. Returns the arguments and the index just after the closing
 * parenthesis, or `null` if the call is unterminated. Same splitter as
 * `no-shell-spawn.guard.spec.ts`.
 */
function splitTopLevelArgs(
  source: string,
  from: number,
): { args: string[]; end: number } | null {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;

  for (let i = from; i < source.length; i++) {
    const ch = source[i];

    if (quote !== null) {
      current += ch;
      if (ch === '\\') {
        current += source[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (ch === ')' && depth === 0) {
        args.push(current);
        return { args, end: i + 1 };
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  return null;
}

/** Every spawn call in one file's source text that omits `windowsHide`. */
export function findVisibleWindowSpawns(
  rawSource: string,
  file: string,
): Offender[] {
  const source = blankComments(rawSource);
  const offenders: Offender[] = [];
  CALL_START.lastIndex = 0;
  let call: RegExpExecArray | null;

  while ((call = CALL_START.exec(source)) !== null) {
    const name = call[1];
    if (
      (name === 'sync' || name === 'default') &&
      !CROSS_SPAWN_MEMBER.test(call[0])
    ) {
      continue;
    }
    // A declaration, not a call: `function spawn(`, `async fork(`.
    const before = source.slice(Math.max(0, call.index - 20), call.index);
    if (/\b(?:function|async)\s+$/.test(before)) continue;

    const split = splitTopLevelArgs(source, call.index + call[0].length);
    if (split === null) continue;
    const args = split.args.filter((argument) => argument.trim() !== '');
    // `fork()` with no arguments, or one bare command, is not a spawn shape.
    if (args.length < 2) continue;
    // A method declaration: `spawnProcess(request: SpawnRequest): Handle {`.
    if (/^\s*[:{]/.test(source.slice(split.end))) continue;

    if (args.slice(1).some((argument) => WINDOWS_HIDE_KEY.test(argument))) {
      continue;
    }

    offenders.push({
      file,
      line: source.slice(0, call.index).split('\n').length,
      call: call[0].trim(),
    });
  }

  return offenders;
}

/** Every production source file under a scan root that can spawn. */
function collectSpawningFiles(root: string): string[] {
  const absoluteRoot = path.join(REPO_ROOT, root);
  return fs
    .readdirSync(absoluteRoot, { recursive: true })
    .map((entry) => path.join(absoluteRoot, String(entry)))
    .filter(
      (file) =>
        /\.(?:ts|tsx|js|mjs|cjs)$/.test(file) &&
        !EXCLUDED_PATH.test(file) &&
        fs.statSync(file).isFile() &&
        SPAWN_MODULE.test(fs.readFileSync(file, 'utf8')),
    );
}

describe('every production spawn sets windowsHide', () => {
  it.each(SCAN_ROOTS)('scans a real tree: %s', (root) => {
    expect(fs.existsSync(path.join(REPO_ROOT, root))).toBe(true);
  });

  it('finds spawning files to scan', () => {
    const files = SCAN_ROOTS.flatMap(collectSpawningFiles);
    expect(files.length).toBeGreaterThan(10);
  });

  it('finds no spawn without windowsHide', () => {
    const offenders: Offender[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of collectSpawningFiles(root)) {
        offenders.push(
          ...findVisibleWindowSpawns(
            fs.readFileSync(file, 'utf8'),
            path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
          ),
        );
      }
    }

    const report = offenders
      .map((o) => `  ${o.file}:${o.line} — ${o.call}`)
      .join('\n');

    expect(
      offenders.length === 0
        ? ''
        : `spawn without windowsHide (flashes a console on Windows):\n${report}\n` +
            'Add `windowsHide: true`, or route it through OffThreadProcessSpawner; see the header of this spec.',
    ).toBe('');
  });

  /**
   * The scan above passes trivially if the matcher is broken, so the matcher is
   * pinned against the shapes this task fixed and the shapes that must pass.
   */
  describe('the matcher', () => {
    it.each([
      [
        'cross-spawn with an options object',
        `const child = crossSpawn('gh', args, {\n  cwd,\n  stdio: ['ignore', 'pipe', 'pipe'],\n});`,
      ],
      [
        'node spawn with a spread args array',
        `spawn('npx', ['skills', ...args], { cwd });`,
      ],
      [
        'an injected spawn function',
        `const proc = this.spawnFn(ffmpeg, ['-i', input], { stdio: 'pipe' });`,
      ],
      [
        'a dynamic cross-spawn import',
        `const child = crossSpawn.default('git', ['worktree', 'list'], { cwd });`,
      ],
      ['fork', `this.child = fork(hostPath, [], { execArgv: [] });`],
      [
        'spawnSync without options',
        `spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);`,
      ],
      [
        'the key only in a comment',
        `spawn('git', args, {\n  // windowsHide: true,\n  cwd,\n});`,
      ],
    ])('rejects %s', (_label, sample) => {
      expect(findVisibleWindowSpawns(sample, 'sample.ts')).toHaveLength(1);
    });

    it.each([
      [
        'windowsHide: true',
        `spawn('where', [name], { stdio: 'pipe', windowsHide: true });`,
      ],
      [
        'a computed windowsHide (needsConsole)',
        `crossSpawn(binary, args, { env, windowsHide: !needsConsole });`,
      ],
      [
        'execFile with a callback after the options',
        `execFile('git', ['status'], { windowsHide: true }, callback);`,
      ],
      [
        'a method declaration',
        `spawn(command: string, args: string[]): ChildProcess {\n  return x;\n}`,
      ],
      [
        'a function declaration',
        `export function spawn(binary: string, args: string[]) {}`,
      ],
      ['regex exec is not a spawn', `const m = PATTERN.exec(text);`],
      ['an unrelated .default call', `config.default(a, b);`],
    ])('accepts %s', (_label, sample) => {
      expect(findVisibleWindowSpawns(sample, 'sample.ts')).toEqual([]);
    });
  });
});
