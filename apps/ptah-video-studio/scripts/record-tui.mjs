/**
 * record-tui.mjs — drive the real `ptah tui` on a pseudo-terminal and record it.
 *
 * This is the TUI equivalent of the Electron showcase capture: Playwright drives
 * the app there, node-pty drives it here. The output is an **asciicast v2** file
 * (ANSI bytes + timings) rather than a video, which is strictly better for a
 * terminal UI — a few hundred KB instead of tens of MB, and the text stays
 * vector-crisp at whatever resolution we render it at later.
 *
 * ## Why this does not reuse tests/e2e/_harness/pty-runner.ts
 *
 * That harness exists to make assertions, and its two most important decisions
 * are exactly wrong for capture: it sets `NO_COLOR=1` and it runs every read
 * through `stripAnsi()`, because a spec wants prose, not SGR runs. It also keeps
 * no timings at all — `onData` appends to a string. We want the opposite of all
 * three. It is also TypeScript under a Jest config, so a plain `.mjs` tool
 * cannot import it without a build step. Same idea, inverted requirements.
 *
 * ## Determinism
 *
 * Capture is live and therefore NOT deterministic — a real agent turn differs
 * every run, exactly as a real Electron capture does. Determinism starts at the
 * NEXT stage: `tui-frames.mjs` replays this cast into a fixed per-frame grid,
 * and everything downstream is a pure function of that. Record once, re-render
 * forever.
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/record-tui.mjs --scene tui-orchestration
 *     [--cols 120] [--rows 32]
 *     [--workspace <path>]   real repo to run in (default: the Ptah workspace)
 *     [--model <id>]         default: claude-sonnet-5
 *     [--auth-from-home]     reuse the credentials you are ALREADY signed in with
 *     [--live]               use an explicit key from the environment instead
 *
 * ## Authentication
 *
 * Ptah itself needs no key — it is free and unlicensed. What needs credentials
 * is the MODEL PROVIDER: an agent cannot talk to Claude without some way to
 * authenticate to Anthropic. `authMethod` supports `apiKey`, `claudeCli` (an
 * existing subscription login) and `thirdParty`, so an API key is only one of
 * the options.
 *
 * The reason this script needs told about auth at all is that it records in an
 * ISOLATED temp HOME — right for a hermetic test, but it means there are no
 * credentials there unless we put some in. Three modes:
 *
 *   (default)          fake, self-describing key. Every surface works except a
 *                      real agent turn.
 *   --auth-from-home   copy the credential files out of your real ~/.ptah into
 *                      the clean recording home. Uses whatever you are already
 *                      signed in with, spends whatever that account spends, and
 *                      leaves your real session history out of the video.
 *   --live             explicit key from PTAH_RECORD_API_KEY / ANTHROPIC_API_KEY.
 *
 * `--auth-from-home` copies `settings.json` wholesale, so do NOT script the
 * walkthrough into Settings unless you have checked what is in yours.
 *
 * Output: dist/apps/ptah-electron-e2e/recordings/<scene>/{tui.cast,tui-beats.json}
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { WORKSPACE_ROOT, sceneDir, parseArgs, loadStudioEnv } from './paths.mjs';

loadStudioEnv();
const require = createRequire(import.meta.url);

/** Same fake key the pty specs use — self-describing if it ever leaks into a log. */
const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

/** Control bytes, mirroring the KEYS table in the pty harness. */
const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  /** Ctrl+<letter> is that letter's ASCII control code. */
  ctrl: (l) => String.fromCharCode(l.toLowerCase().charCodeAt(0) - 96),
  /** Alt+<key> is ESC then the key; Ink reports `{ meta: true }`. */
  alt: (l) => `\x1b${l}`,
};

/** Quiet period that counts as "the repaint finished". */
const SETTLE_MS = 900;
/** Per-character delay when typing, so the recording shows a human typing. */
const TYPE_DELAY_MS = 45;
/**
 * Gap between navigation keys. Not cosmetic: writing a burst of arrow keys with
 * no delay lets Ink coalesce them, and the cursor lands somewhere unpredictable
 * — that is why an earlier take opened the wrong provider tile. It also reads
 * better on camera, since you can see the selection move.
 */
const KEY_DELAY_MS = 110;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Strip ANSI for the WAIT predicates only. The recorded stream keeps every byte;
 * this copy exists solely so `waitFor` can match prose the way the specs do.
 */
function stripAnsi(text) {
  /* eslint-disable no-control-regex */
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '');
  /* eslint-enable no-control-regex */
}

/**
 * The walkthrough. Each step is one beat in the finished video, so the labels
 * here become the narration anchors in the promo spec.
 *
 * `wait` is matched against ANSI-stripped output, never against layout — ConPTY
 * reflows and box-drawing borders interleave mid-repaint (the pty harness header
 * explains this at length; the same rule applies).
 */
function buildSteps(opts) {
  // Connect-first walkthrough. A cold start lands on Settings → Authentication
  // with the provider list up, which is the honest opening frame: nothing is
  // configured yet. The Claude (Subscription) tile then picks up the ambient
  // `~/.claude` login with no key to paste — that is the beat worth filming.
  const connect = opts.authFromHome
    ? [
        {
          label: 'Provider list',
          wait: /Authentication/,
          holdMs: 2000,
        },
        {
          label: 'Find Claude (Subscription)',
          // Boot puts the cursor on index 0. The provider list is:
          //   0 Claude (API key)   1 OpenRouter        2 Moonshot (Kimi)
          //   3 Z.AI (GLM)         4 GitHub Copilot    5 OpenAI Codex
          //   6 Ollama             7 Ollama Cloud      8 LM Studio
          //   9 Claude (Subscription)                 10 Sakana (Fugu)
          // so the subscription tile is 9 down. Verify with:
          //   probe-tui.mjs --auth-from-home --tail 40
          // and read the `>` marker — a short --tail silently crops the top of
          // the list and makes this count look smaller than it is.
          keys: Array.from({ length: 9 }, () => KEYS.down),
          holdMs: 1600,
        },
        {
          label: 'Open the subscription tile',
          keys: [KEYS.enter],
          // Text ONLY the subscription detail renders — the api-key tile shows
          // "Key: Not configured" instead, so this catches a wrong-tile landing.
          wait: /Claude CLI detected|managed by the Claude CLI/,
          holdMs: 2800,
        },
        {
          label: 'Set as active & test',
          // The tile needs a SECOND Enter to commit ("Enter: set as active &
          // test"). Opening it is not connecting it — an earlier take escaped
          // out after the first press, so auth never activated and every turn
          // died on the 60s streaming timeout.
          keys: [KEYS.enter],
          settleMs: 2500,
          holdMs: 2600,
          timeoutMs: 60_000,
        },
        {
          label: 'Back to chat',
          keys: [KEYS.escape, KEYS.escape],
          wait: /The Coding Orchestra/,
          holdMs: 1800,
        },
      ]
    : [{ label: 'Launch', wait: /The Coding Orchestra/, holdMs: 2200 }];

  return [
    ...connect,
    {
      label: 'Model selector',
      keys: [KEYS.alt('m')],
      wait: /per Mtok/,
      holdMs: 2600,
    },
    {
      label: 'Close selector',
      keys: [KEYS.escape],
      holdMs: 700,
    },
    {
      label: 'Ask for the work',
      type: opts.prompt,
      holdMs: 900,
    },
    {
      label: 'Send',
      keys: [KEYS.enter],
      // The conductor classifying and delegating is the money shot. Give it a
      // long window; a live turn takes as long as it takes.
      wait: opts.live ? /(specialist|delegat|review|classif|Done|Completed)/i : null,
      settleMs: opts.live ? 4000 : 1500,
      holdMs: opts.live ? 4000 : 2000,
      timeoutMs: 240_000,
    },
    {
      label: 'Sessions panel',
      keys: [KEYS.alt('l')],
      wait: /Sessions/,
      holdMs: 2600,
    },
  ];
}

async function record(opts) {
  const pty = require('node-pty');
  const dir = sceneDir(opts.scene);
  fs.mkdirSync(dir, { recursive: true });

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-tui-rec-'));
  const ptahDir = path.join(home, '.ptah');
  fs.mkdirSync(ptahDir, { recursive: true });

  if (opts.authFromHome) {
    // Inherit the CLAUDE CLI login, not Ptah's own config.
    //
    // Copying `~/.ptah/secrets.enc` does not work: `master-key-ref.json` points
    // at an OS-keychain entry scoped to the real profile, so the secret never
    // decrypts under a temp HOME and the TUI sits on "Key: Not configured".
    // The Claude Subscription tile sidesteps that entirely — it runs on ambient
    // `~/.claude` credentials with no endpoint and no key (see AuthSection's
    // `nativeAuth` tile), so copying the CLI's own login is all that is needed.
    //
    // Ptah settings are deliberately NOT seeded here. A cold start lands on
    // Settings → Authentication, which is exactly the frame the video opens on:
    // connecting the subscription you already have, on camera.
    const copied = [];
    for (const name of ['.claude', '.claude.json']) {
      const src = path.join(os.homedir(), name);
      if (!fs.existsSync(src)) continue;
      fs.cpSync(src, path.join(home, name), { recursive: true });
      copied.push(name);
    }
    if (copied.length === 0) {
      throw new Error(
        'No ~/.claude login to inherit. Run `claude login` first, or use --live with a key.',
      );
    }
    console.log(`[rec] Claude CLI login inherited (${copied.join(', ')}) — starting Ptah cold.`);
  } else {
    // Seed the settings a configured user would have, BEFORE spawn — a post-boot
    // write races `resolveInitialView` and the recording opens on Settings.
    fs.writeFileSync(
      path.join(ptahDir, 'settings.json'),
      JSON.stringify(
        {
          llm: { defaultProvider: 'claude' },
          auth: { defaultProvider: 'claude', authMethod: 'apiKey' },
          mainAgent: { model: opts.model },
        },
        null,
        2,
      ),
    );
  }

  const env = { ...process.env };
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'COPILOT_TOKEN', 'GITHUB_TOKEN']) {
    delete env[k];
  }
  env['HOME'] = home;
  env['USERPROFILE'] = home;
  env['APPDATA'] = path.join(home, 'AppData', 'Roaming');
  env['LOCALAPPDATA'] = path.join(home, 'AppData', 'Local');
  env['TERM'] = 'xterm-256color';
  // The single most important difference from the test harness: KEEP colour.
  delete env['NO_COLOR'];
  env['FORCE_COLOR'] = '3';
  // With --auth-from-home the credentials come from the copied ~/.ptah, so
  // injecting a key here would override whatever you are actually signed in
  // with — including a subscription login, which has no key to inject.
  if (opts.apiKey) {
    env['ANTHROPIC_API_KEY'] = opts.apiKey;
  } else {
    delete env['ANTHROPIC_API_KEY'];
  }

  const child = pty.spawn(process.execPath, [opts.mainMjs, 'tui'], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.workspace,
    env,
  });

  /** @type {[number, 'o', string][]} asciicast v2 event stream. */
  const events = [];
  /** @type {{tMs:number,label:string}[]} */
  const beats = [];
  const t0 = Date.now();
  let plain = '';
  let lastDataAt = Date.now();
  let exited = false;

  child.onData((data) => {
    events.push([(Date.now() - t0) / 1000, 'o', data]);
    plain += stripAnsi(data);
    lastDataAt = Date.now();
  });
  child.onExit(() => {
    exited = true;
  });

  const settle = async (quietMs = SETTLE_MS, timeoutMs = 20_000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (exited) return;
      if (Date.now() - lastDataAt > quietMs) return;
      await sleep(80);
    }
  };

  /**
   * The agent gates every tool call behind an approval prompt, and the gate can
   * appear at any point during a turn — so this is a watcher rather than a step.
   * Left on camera for a beat before answering, because "nothing runs without
   * your say-so" is worth showing, then `a` (Always Allow) so one press covers
   * the rest of the turn instead of stalling on every subsequent call.
   */
  const APPROVAL_RE = /Y Allow\s+N Deny|A Always Allow/;
  let approvals = 0;
  const answerApprovalIfShown = async () => {
    if (!APPROVAL_RE.test(plain)) return false;
    await sleep(1400); // let it read on screen
    child.write('a');
    approvals++;
    console.log(`[rec]   approval gate #${approvals} -> Always Allow`);
    plain = '';
    await sleep(600);
    return true;
  };

  const waitFor = async (pattern, timeoutMs) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (pattern.test(plain)) return true;
      if (exited) return false;
      await answerApprovalIfShown();
      await sleep(150);
    }
    console.warn(`[rec] timed out waiting for ${pattern} — continuing.`);
    return false;
  };

  console.log(`[rec] ${opts.scene}: ${opts.cols}x${opts.rows}, live=${opts.live}, cwd=${opts.workspace}`);
  await waitFor(/The Coding Orchestra|Authentication/, 90_000);
  await settle();

  for (const step of buildSteps(opts)) {
    beats.push({ tMs: Math.round(Date.now() - t0), label: step.label });
    console.log(`[rec]   beat: ${step.label}`);

    if (step.type) {
      // Character by character, so the finished video shows typing rather than
      // a line appearing whole.
      for (const ch of step.type) {
        child.write(ch);
        await sleep(TYPE_DELAY_MS);
      }
    }
    for (const k of step.keys ?? []) {
      child.write(k);
      await sleep(KEY_DELAY_MS);
    }

    if (step.wait) await waitFor(step.wait, step.timeoutMs ?? 60_000);
    await settle(step.settleMs ?? SETTLE_MS, step.timeoutMs ?? 30_000);
    if (step.holdMs) await sleep(step.holdMs);
  }

  // Quit the way a user does; fall back to a kill.
  try {
    child.write(KEYS.ctrl('c'));
    child.write(KEYS.ctrl('c'));
    const deadline = Date.now() + 4000;
    while (!exited && Date.now() < deadline) await sleep(100);
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

  const durationMs = Math.round(Date.now() - t0);
  const castPath = path.join(dir, 'tui.cast');
  const header = {
    version: 2,
    width: opts.cols,
    height: opts.rows,
    title: `ptah tui — ${opts.scene}`,
    env: { TERM: 'xterm-256color', SHELL: '/bin/sh' },
  };
  fs.writeFileSync(
    castPath,
    [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'tui-beats.json'),
    JSON.stringify({ scene: opts.scene, durationMs, cols: opts.cols, rows: opts.rows, beats }, null, 2),
  );

  fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });

  console.log(
    `[rec] Done: ${castPath} (${events.length} events, ${(durationMs / 1000).toFixed(1)}s, ` +
      `${(fs.statSync(castPath).size / 1024).toFixed(0)} KB)`,
  );
  for (const b of beats) console.log(`[rec]   ${(b.tMs / 1000).toFixed(1)}s  ${b.label}`);
}

function main() {
  const args = parseArgs();
  const scene = typeof args.scene === 'string' ? args.scene : 'tui-orchestration';
  const authFromHome = Boolean(args['auth-from-home']);
  const live = Boolean(args.live);

  if (authFromHome && live) {
    throw new Error('Pick one: --auth-from-home inherits your login, --live injects a key.');
  }

  // null = inject nothing, let the copied ~/.ptah credentials speak.
  const apiKey = authFromHome
    ? null
    : live
      ? process.env['PTAH_RECORD_API_KEY'] || process.env['ANTHROPIC_API_KEY']
      : FAKE_API_KEY;
  if (live && !apiKey) {
    throw new Error(
      '--live needs a real key in PTAH_RECORD_API_KEY or ANTHROPIC_API_KEY. ' +
        'Use --auth-from-home to reuse the login you already have, or omit both ' +
        'to record with the fake key (no live agent turn).',
    );
  }

  const mainMjs = path.join(WORKSPACE_ROOT, 'dist', 'apps', 'ptah-cli', 'main.mjs');
  if (!fs.existsSync(mainMjs)) {
    throw new Error(`No CLI bundle at ${mainMjs}. Run: npx nx build ptah-cli --skip-nx-cache`);
  }

  return record({
    scene,
    // A real agent turn happens whenever we are NOT on the fake key.
    live: live || authFromHome,
    authFromHome,
    apiKey,
    mainMjs,
    // 120x32 divides 1920 evenly at 16px per column, which is a comfortable
    // monospace advance at 1080p — see tui-frames.mjs / TerminalPlayer.
    cols: args.cols ? Number(args.cols) : 120,
    rows: args.rows ? Number(args.rows) : 32,
    workspace: typeof args.workspace === 'string' ? path.resolve(args.workspace) : WORKSPACE_ROOT,
    model: typeof args.model === 'string' ? args.model : 'claude-sonnet-5',
    prompt:
      typeof args.prompt === 'string'
        ? args.prompt
        : 'orchestrate "add retry with backoff to the Paddle webhook handler"',
  });
}

main().catch((error) => {
  console.error(`[rec] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
