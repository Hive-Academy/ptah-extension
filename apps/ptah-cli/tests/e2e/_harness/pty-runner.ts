/**
 * PtyRunner — drives `ptah tui` on a REAL pseudo-terminal.
 *
 * Why this exists. `CliRunner` spawns the dist bundle with piped stdio, which
 * is right for JSON-RPC but useless for the TUI: `main.tsx` refuses to run
 * without a TTY, and Ink's `useInput` never receives a keystroke from a pipe.
 * So every TUI interaction defect was, until now, unprovable — the handlers
 * and reducers could be unit-tested, but *that pressing the key reaches them*
 * could not. Three defects fixed under TASK_2026_234 shipped with exactly that
 * gap written into the commit message. This closes it.
 *
 * `node-pty` needs no new dependency and no native rebuild: it is already in
 * the workspace for the editor terminal, it ships N-API prebuilds, and
 * `apps/ptah-electron/scripts/rebuild-native.js` deliberately skips it as
 * ABI-stable. It therefore loads under plain Node, which is what Jest runs.
 *
 * ## Reading the screen
 *
 * Ink repaints by clearing and rewriting the whole frame, so the bytes
 * arriving after a keystroke ARE the new frame. `screen()` therefore reports
 * output since the last `clear()` rather than emulating a terminal — a real
 * emulator would be more faithful and is not worth the dependency here.
 *
 * Two consequences worth knowing before writing an assertion:
 *
 *   - Reads must SETTLE, never snapshot. A frame arrives in several writes and
 *     a single read catches a half-drawn one. Every method here waits for the
 *     stream to go quiet first.
 *   - Assert on prose, never on layout. ConPTY reflows, box-drawing borders
 *     interleave with content mid-repaint, and a wide modal wraps. `cols` and
 *     `rows` are pinned for stability, but a test that matches a border or a
 *     column position is a test that fails on the next terminal.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ptyModule from 'node-pty';

/** Control bytes, named. `ctrl('o')` is the chord Ink reports as ctrl + 'o'. */
export const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  /**
   * Ctrl+<letter> is the ASCII control code for that letter. Note that
   * `ctrl('m')` is `\r` — identical to {@link KEYS.enter}, which is the whole
   * reason `agent.model` could not stay on Ctrl+M.
   */
  ctrl(letter: string): string {
    const code = letter.toLowerCase().charCodeAt(0) - 96;
    return String.fromCharCode(code);
  },
  /**
   * Alt+<key> is ESC followed by the key. Ink reports it as
   * `{ meta: true, input: '<key>' }` — verified on a real pty, and distinct
   * from bare Escape, which arrives as `{ escape: true }` with no meta. That
   * distinction is what lets the app bindings live on Alt without colliding
   * with the Escape-to-close behaviour.
   */
  alt(letter: string): string {
    return `\x1b${letter}`;
  },
  /** CSI Z. Ink reports `{ shift: true, tab: true }` with empty input. */
  shiftTab: '\x1b[Z',
} as const;

export interface PtySession {
  /** Output since the last `clear()`, ANSI stripped and blank lines dropped. */
  screen(): string;
  /** Drop everything buffered so the next `screen()` reads one frame only. */
  clear(): void;
  /** Send keys, then wait for the repaint to finish. */
  press(keys: string): Promise<string>;
  /**
   * Send Alt+<letter> as TWO reads — the ESC first, the letter `gapMs` later.
   *
   * Not a synthetic case. Ink assembles `ESC` + key into one meta keypress only
   * while both bytes are still in flight: `components/App.tsx` arms a 20ms
   * timer on a dangling ESC and, when it fires, emits the ESC on its own and
   * the letter after it as a plain character. So whenever the two bytes reach
   * `stdin` in separate reads more than that apart — a busy event loop is
   * enough, since the timers phase runs before poll — the chord arrives as
   * "Escape, then a letter" and every `key.meta` handler is bypassed.
   *
   * `press(KEYS.alt('m'))` writes both bytes at once and can never show this.
   * The default gap is deliberately just past the window.
   */
  pressMetaSplit(letter: string, gapMs?: number): Promise<string>;
  /** Wait until the screen matches, or throw with the last frame attached. */
  waitForText(pattern: RegExp, timeoutMs?: number): Promise<string>;
  /** Quit the way a user does, falling back to a kill. Always safe to call. */
  dispose(): Promise<void>;
}

export interface StartTuiOptions {
  /** Absolute path to the built `main.mjs`. */
  readonly mainMjs: string;
  /** Isolated HOME for this run. */
  readonly home: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cols?: number;
  readonly rows?: number;
  /** How long to allow for DI bootstrap and the first painted frame. */
  readonly bootTimeoutMs?: number;
  /**
   * Boot CONFIGURED rather than cold.
   *
   * Without this the TUI has no credentials, so `resolveInitialView` opens
   * Settings → Authentication and the session list is permanently empty —
   * which means every surface that lives behind "the user has actually set
   * this up" is unreachable. That is a real limit on what a cold-start
   * harness can prove, not a detail.
   *
   * The key is fake and never reaches upstream; it exists so SDK init
   * succeeds, exactly as `bootstrap` / `headless-task` / `permission-gates`
   * already do it. Seeds `~/.ptah/settings.json` with the provider and model
   * so the app boots the way a set-up user's does.
   */
  readonly configured?: {
    readonly apiKey?: string;
    readonly provider?: string;
    readonly model?: string;
  };
  /** Real project folder to run in, so `workspacePath` is a genuine repo. */
  readonly workspace?: string;
}

/** Quiet period that counts as "the repaint finished". */
const SETTLE_MS = 1200;
/** How long to give a keystroke to produce its first byte before calling it inert. */
const NO_REPAINT_MS = 4_000;
const DEFAULT_BOOT_TIMEOUT_MS = 60_000;

/**
 * Fake, and deliberately self-describing: if this ever shows up in a request
 * log, the leak is obvious. Same value the JSON-RPC e2e specs use.
 */
export const PTY_FAKE_API_KEY =
  'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

function ptyEnv(home: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Strip FIRST, always. A developer's real key in the ambient environment
  // would flip the initial view from Settings to chat, and the cold-start
  // specs would assert against a surface they never meant to test. Anything
  // the caller wants back is re-added below, explicitly.
  delete env['ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_AUTH_TOKEN'];
  delete env['OPENAI_API_KEY'];
  delete env['COPILOT_TOKEN'];
  delete env['GITHUB_TOKEN'];
  env['HOME'] = home;
  env['USERPROFILE'] = home;
  env['APPDATA'] = path.join(home, 'AppData', 'Roaming');
  env['LOCALAPPDATA'] = path.join(home, 'AppData', 'Local');
  // A real TERM, because this IS a real terminal — but NO_COLOR so the frame
  // is readable text rather than a wall of SGR runs.
  env['TERM'] = 'xterm-256color';
  env['NO_COLOR'] = '1';
  return { ...env, ...(extra ?? {}) };
}

/**
 * Strip OSC title writes, CSI/SGR runs and charset selections; keep the text
 * they wrapped.
 *
 * `no-control-regex` is disabled deliberately and narrowly: ESC and BEL are
 * the literal bytes being matched, so the rule has nothing to offer here.
 */
export function stripAnsi(text: string): string {
  /* eslint-disable no-control-regex */
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '');
  /* eslint-enable no-control-regex */
}

export async function startTui(opts: StartTuiOptions): Promise<PtySession> {
  const ptahDir = path.join(opts.home, '.ptah');
  fs.mkdirSync(ptahDir, { recursive: true });

  const configured = opts.configured;
  if (configured !== undefined) {
    // Seed the same file a set-up user would have. Written before spawn so
    // the settings store reads it during bootstrap rather than after the
    // first frame — a post-boot write would race the initial view.
    const provider = configured.provider ?? 'claude';
    const settings = {
      llm: { defaultProvider: provider },
      auth: { defaultProvider: provider, authMethod: 'apiKey' },
      ...(configured.model !== undefined
        ? { mainAgent: { model: configured.model } }
        : {}),
    };
    fs.writeFileSync(
      path.join(ptahDir, 'settings.json'),
      JSON.stringify(settings, null, 2),
      'utf8',
    );
  }

  const extraEnv: NodeJS.ProcessEnv = { ...(opts.env ?? {}) };
  if (configured !== undefined) {
    extraEnv['ANTHROPIC_API_KEY'] = configured.apiKey ?? PTY_FAKE_API_KEY;
  }

  const child = ptyModule.spawn(process.execPath, [opts.mainMjs, 'tui'], {
    name: 'xterm-256color',
    // Pinned. ConPTY reflows on resize, and a reflow mid-assertion reads as
    // a content change that never happened.
    cols: opts.cols ?? 100,
    rows: opts.rows ?? 30,
    cwd: opts.workspace ?? opts.home,
    env: ptyEnv(opts.home, extraEnv) as Record<string, string>,
  });

  let buffer = '';
  let lastDataAt = Date.now();
  let exited = false;

  child.onData((data: string) => {
    buffer += data;
    lastDataAt = Date.now();
  });
  child.onExit(() => {
    exited = true;
  });

  const settle = async (
    quietMs = SETTLE_MS,
    timeoutMs = 20_000,
  ): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (exited) return;
      if (Date.now() - lastDataAt > quietMs) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  /** Resolve once any byte lands, or give up — "no repaint" is a valid result. */
  const waitForFirstByte = async (timeoutMs: number): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (buffer.length > 0 || exited) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const screen = (): string =>
    stripAnsi(buffer)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .join('\n');

  const session: PtySession = {
    screen,
    clear(): void {
      buffer = '';
    },
    async press(keys: string): Promise<string> {
      buffer = '';
      child.write(keys);
      // Wait for the repaint to START before waiting for it to finish.
      // Without this, `settle()` returns instantly: the stream has been quiet
      // since the previous frame, so "no data for 1200ms" is already true the
      // moment the key is written and the read lands before a single byte of
      // the response. That read returns an empty screen, and an empty screen
      // satisfies every `not.toMatch` assertion — a silently vacuous pass.
      //
      // A key that legitimately paints nothing (Ctrl+M) simply exhausts the
      // window and returns ''. That is a real result, and the specs that rely
      // on it prove liveness with a second keystroke rather than trusting it.
      await waitForFirstByte(NO_REPAINT_MS);
      await settle();
      return screen();
    },
    async pressMetaSplit(letter: string, gapMs = 40): Promise<string> {
      buffer = '';
      child.write(KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      child.write(letter);
      await waitForFirstByte(NO_REPAINT_MS);
      await settle();
      return screen();
    },
    async waitForText(pattern: RegExp, timeoutMs = 30_000): Promise<string> {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (pattern.test(screen())) {
          // Let the rest of the frame land before the caller reads it.
          await settle();
          return screen();
        }
        if (exited) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(
        `waitForText timed out after ${timeoutMs}ms waiting for ${String(
          pattern,
        )}.\n--- last screen ---\n${screen()}\n--- end ---`,
      );
    },
    async dispose(): Promise<void> {
      if (exited) return;
      // Ctrl+C twice is the TUI's own quit path, so this exercises the
      // shutdown a user gets. It does not always take: the shell's `useInput`
      // is inactive while a modal is up, so a spec that ends with the model
      // selector open never sees the chord and falls through to `kill()`.
      //
      // Expect `AttachConsole failed` on stderr from those runs. It comes
      // from node-pty's console-list helper process during ConPTY teardown,
      // not from anything under test, and it does not fail a spec. Writing
      // Escape first to close the modal was tried and changed nothing.
      try {
        child.write(KEYS.ctrl('c'));
        child.write(KEYS.ctrl('c'));
        const deadline = Date.now() + 5_000;
        while (!exited && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch {
        // already gone
      }
      if (!exited) {
        try {
          child.kill();
        } catch {
          // already gone
        }
      }
      // Do NOT kill an already-exited pty to "be safe": on Windows that makes
      // node-pty spawn its console-list agent, which prints `AttachConsole
      // failed` into the test output. It also would not help — the PIPEWRAP
      // that outlives the process belongs to `WindowsPtyAgent` and no public
      // API releases it. That is why the pty suite runs under its own Jest
      // config with `forceExit`; see `jest.pty.config.cjs`.
    },
  };

  // Which frame counts as "booted" depends on how it was started, because
  // `resolveInitialView` routes on whether auth is present: cold lands on
  // Settings → Authentication, configured lands on the chat welcome.
  await session.waitForText(
    configured !== undefined ? /The Coding Orchestra/ : /Authentication/,
    opts.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS,
  );
  return session;
}

/** Convenience for specs that only need a throwaway HOME. */
export function makePtyHome(prefix = 'ptah-pty-e2e-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
