/**
 * Source guard: no spawn-family call may pass BOTH an argument list and a
 * `shell` option that is not literally `false`.
 *
 * WHY A SOURCE SCAN AND NOT A RUNTIME ASSERTION. Node prints a deprecation code
 * ONCE PER PROCESS. `[DEP0190] Passing args to a child process with shell
 * option true can lead to security vulnerabilities` fired at boot from
 * `ClaudeCliDetector`'s Windows probe, and that single line was the whole
 * observable evidence for THREE offenders — the detector, `runSkillsCli`, and
 * the CLI's OAuth browser launcher. Fix the first and the warning goes quiet
 * while the other two keep concatenating arguments into a `cmd.exe` command
 * line unescaped. Only a scan of the source sees all of them (TASK_2026_348).
 *
 * WHY A SMALL SCANNER AND NOT ONE REGEX. The offenders do not share a shape: the
 * detector passed an `args` IDENTIFIER (`spawn(command, args, { shell:
 * needsShell })`), `runSkillsCli` passed an array literal, and the CLI opener
 * called an injected `this.spawner(...)`. A regex anchored on `[` misses the
 * first, one anchored on `spawn(` misses the third, and `\s*(?!false)` matches
 * ` false` by backtracking to zero width — a guard that passes the very code
 * this task deleted. So the call arguments are split for real (balanced
 * brackets, quote-aware) and the decision is made on the ARITY plus the
 * `shell` value: three or more arguments means an argument list is being
 * passed, which is exactly the DEP0190 condition. `spawn(cmd, { shell: true })`
 * — a full command line as one string — is legal and stays legal.
 *
 * A computed flag (`shell: needsShell`) is rejected deliberately: that is how
 * the detector kept the pattern while looking conditional.
 *
 * THE FIX when this fails is `cross-spawn`: it resolves bare commands through
 * PATH/PATHEXT and runs Windows `.cmd`/`.bat` wrappers via `cmd.exe /d /s /c`
 * with every argument escaped, which is the only thing `shell: true` was ever
 * used for here. To reach a cmd.exe BUILTIN (`start`), name the shell as the
 * executable — `spawn('cmd', ['/c', 'start', '', url])` — never as an option.
 *
 * KNOWN LIMIT: an options object built in a separate statement and passed by
 * name is not seen. Nothing in the scanned trees does that today, and the
 * alternative (a TypeScript program + type checker per run) costs more than the
 * defect it would catch.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Repo root: this file lives at libs/backend/agent-sdk/src/lib/detector/. */
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

/**
 * Source trees that spawn CLI processes. Named explicitly rather than scanning
 * the whole repo so a failure says which lib regressed, and so a new lib that
 * starts spawning has to make a deliberate choice to join the guard.
 */
const SCAN_ROOTS = [
  'libs/backend/cli-agent-runtime/src',
  'libs/backend/auth-providers/src',
  'libs/backend/vscode-lm-tools/src',
  'libs/backend/agent-sdk/src',
  'libs/backend/rpc-handlers/src',
  'apps/ptah-cli/src',
];

/**
 * Any callee whose name contains `spawn`, plus the `execFile` pair (which take
 * the same `(command, args, options)` shape and the same `shell` option).
 * Matching the name loosely is what catches an injected `this.spawner(...)`.
 */
const CALL_START = /\b(?:[\w$]*[sS]pawn[\w$]*|execFile|execFileSync)\s*\(/g;

/** `shell: <value>` inside an options object, ignoring `foo.shell` members. */
const SHELL_OPTION = /(?:^|[^\w.$])shell\s*[:=]\s*([^,\n}]+)/;

interface Offender {
  readonly file: string;
  readonly line: number;
  readonly shellValue: string;
}

/**
 * Split a call's arguments at bracket depth zero, starting just after its open
 * parenthesis. Returns `null` if the call is unterminated (never happens in
 * source that compiles, but the scanner must not loop forever on it).
 */
function splitTopLevelArgs(source: string, from: number): string[] | null {
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
        return args;
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

/** Every offending spawn call in one file's source text. */
export function findShellSpawnOffenders(
  source: string,
  file: string,
): Offender[] {
  const offenders: Offender[] = [];
  CALL_START.lastIndex = 0;
  let call: RegExpExecArray | null;

  while ((call = CALL_START.exec(source)) !== null) {
    const args = splitTopLevelArgs(source, call.index + call[0].length);
    // Fewer than three arguments means no argument LIST is being passed, so
    // `shell` cannot produce the DEP0190 concatenation.
    if (args === null || args.length < 3) continue;

    // Search every argument after the args list — `execFile(cmd, args, options,
    // callback)` puts the options object third of four.
    const shell = args
      .slice(2)
      .map((argument) => SHELL_OPTION.exec(argument))
      .find((match): match is RegExpExecArray => match !== null);
    if (shell === undefined) continue;

    const shellValue = shell[1].trim().replace(/[,;)]+$/, '');
    if (shellValue === 'false') continue;

    offenders.push({
      file,
      line: source.slice(0, call.index).split('\n').length,
      shellValue,
    });
  }

  return offenders;
}

/** Every non-spec `.ts` file under a scan root, as absolute paths. */
function collectSourceFiles(root: string): string[] {
  const absoluteRoot = path.join(REPO_ROOT, root);
  return fs
    .readdirSync(absoluteRoot, { recursive: true })
    .map((entry) => path.join(absoluteRoot, String(entry)))
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.spec.ts') &&
        fs.statSync(file).isFile(),
    );
}

describe('no shell spawn with an args array', () => {
  it('resolves the repo root from __dirname', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'nx.json'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'package.json'))).toBe(true);
  });

  it.each(SCAN_ROOTS)('scans a real, non-empty tree: %s', (root) => {
    expect(fs.existsSync(path.join(REPO_ROOT, root))).toBe(true);
    expect(collectSourceFiles(root).length).toBeGreaterThan(0);
  });

  it('finds no offender in any scanned lib', () => {
    const offenders: Offender[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of collectSourceFiles(root)) {
        offenders.push(
          ...findShellSpawnOffenders(
            fs.readFileSync(file, 'utf8'),
            path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
          ),
        );
      }
    }

    const report = offenders
      .map((o) => `  ${o.file}:${o.line} — shell: ${o.shellValue}`)
      .join('\n');

    expect(
      offenders.length === 0
        ? ''
        : `spawn with an args list and a shell option (DEP0190):\n${report}\n` +
            'Route it through cross-spawn instead; see the header of this spec.',
    ).toBe('');
  });

  /**
   * The scan above passes trivially if the matcher is broken, so the matcher is
   * pinned against the three shapes this task actually removed and against the
   * legal shapes that must keep compiling.
   */
  describe('the matcher', () => {
    it.each([
      [
        'the detector (identifier args, computed flag)',
        `const child = spawn(command, args, {\n  stdio: 'pipe',\n  windowsHide: true,\n  shell: needsShell,\n});`,
        'needsShell',
      ],
      [
        'runSkillsCli (array literal, literal true)',
        `const child = spawn('npx', ['skills', ...args], {\n  shell: true,\n  cwd: cwd || undefined,\n});`,
        'true',
      ],
      [
        'the OAuth opener (injected spawner, inline expression)',
        `const child = this.spawner(command, args, {\n  detached: true,\n  stdio: 'ignore',\n  shell: this.platform === 'win32',\n});`,
        "this.platform === 'win32'",
      ],
      [
        'cross-spawn is not exempt',
        `crossSpawn('npm', ['--version'], { shell: true });`,
        'true',
      ],
      [
        'execFile is not exempt',
        `execFile('git', ['status'], { shell: true }, callback);`,
        'true',
      ],
    ])('rejects %s', (_label, sample, expected) => {
      const offenders = findShellSpawnOffenders(sample, 'sample.ts');
      expect(offenders).toHaveLength(1);
      expect(offenders[0].shellValue).toBe(expected);
    });

    it.each([
      [
        'explicit false',
        `spawn(command, [commandName], {\n  stdio: 'pipe',\n  shell: false,\n});`,
      ],
      ['no shell option', `crossSpawn(command, args, { stdio: 'pipe' });`],
      [
        'shell:true with a single command string',
        `spawn(command, {\n  shell: true,\n  stdio: ['pipe', 'ignore', 'ignore'],\n});`,
      ],
      [
        'the shell named as the executable',
        `spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });`,
      ],
      [
        'a member named shell on some other object',
        `spawnCli(binary, args, { env: { ...process.env, TERM: opts.shell } });`,
      ],
    ])('accepts %s', (_label, sample) => {
      expect(findShellSpawnOffenders(sample, 'sample.ts')).toEqual([]);
    });
  });
});
