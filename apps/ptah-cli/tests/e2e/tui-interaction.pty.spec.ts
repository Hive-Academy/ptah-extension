/**
 * TUI interaction — real keystrokes on a real pseudo-terminal.
 *
 * `tui.e2e.spec.ts` covers the installed-bundle contract: the no-TTY refusal,
 * the missing-bundle error, and the smoke boot. None of it presses a key,
 * because piped stdio cannot deliver one to Ink's `useInput`.
 *
 * These specs close that gap for the interaction defects fixed under
 * TASK_2026_234. Each one failed against the pre-fix bundle — see the
 * per-spec notes for what the old behaviour was.
 *
 * Scope limit, stated rather than implied: two of that task's defects are NOT
 * reachable here and stay unit-level.
 *
 *   - The sidebar's delete-confirm Escape claim needs a session to delete, and
 *     the session list is empty until a turn has run. Its half of the claim is
 *     covered by `escape-claims.spec.ts`.
 *   - `dispose()` aborting an in-flight turn needs a live provider. e2e runs
 *     with every credential stripped on purpose, so no turn can stream. It is
 *     covered by `use-chat.spec.ts`.
 *
 * Assertions match prose only. ConPTY reflows and box borders interleave with
 * content mid-repaint, so matching layout would pin the terminal, not the app.
 */

import * as fsp from 'node:fs/promises';

import { CliRunner, KEYS, makePtyHome, startTui } from './_harness';
import type { PtySession } from './_harness';

jest.setTimeout(180_000);

describe('ptah tui interaction (pty)', () => {
  let home: string;
  let tui: PtySession | null = null;

  beforeEach(() => {
    home = makePtyHome();
  });

  afterEach(async () => {
    await tui?.dispose();
    tui = null;
    await fsp.rm(home, { recursive: true, force: true, maxRetries: 3 });
  });

  it('boots to Settings → Authentication when no credentials exist', async () => {
    tui = await startTui({ mainMjs: CliRunner.DIST_BIN, home });
    // Not incidental: `resolveInitialView` routes here precisely because auth
    // is missing, and every spec below starts from this frame.
    expect(tui.screen()).toMatch(/Authentication/);
    expect(tui.screen()).toMatch(/Not configured/);
  });

  it('Escape backs out of the auth configurator without leaving Settings', async () => {
    // The defect: `AuthSection` binds Escape while being neither modal nor
    // overlay, which is all the AppShell handler was gated on. One press
    // cancelled the configurator AND closed Settings — two surfaces, one key.
    tui = await startTui({ mainMjs: CliRunner.DIST_BIN, home });

    const configuring = await tui.press(KEYS.enter);
    expect(configuring).toMatch(/Save & Test|edit key|back to providers/);

    const afterFirstEscape = await tui.press(KEYS.escape);
    // Back to the provider list...
    expect(afterFirstEscape).toMatch(/Not configured/);
    // ...and STILL in Settings. This is the assertion that fails pre-fix:
    // the welcome screen was showing by now.
    expect(afterFirstEscape).toMatch(/Authentication/);
    expect(afterFirstEscape).not.toMatch(/The Coding Orchestra/);

    // Only the second press leaves, which is what "one surface per press"
    // means — the walk back to chat is deterministic, not a jump.
    const afterSecondEscape = await tui.press(KEYS.escape);
    expect(afterSecondEscape).toMatch(/The Coding Orchestra/);
  });

  it('opens the model selector on Alt+M and never on Ctrl+M', async () => {
    // Two defects in one binding. It was Ctrl+M, which IS carriage return, so
    // Ink delivered `{name:'return'}` and the handler could never fire. It was
    // then moved to Ctrl+O — deliverable, but VDISCARD at the tty and Gemini's
    // `app.showMoreLines`. Alt+M is the first version that is both reachable
    // and unclaimed.
    //
    // Both halves live in one spec on purpose. Asserting the negative alone is
    // worthless: a dead or hung TUI repaints nothing, `screen()` returns '',
    // and `not.toMatch` passes for entirely the wrong reason. Pressing Ctrl+O
    // afterwards and requiring the selector to appear is what proves the app
    // was alive and listening when Ctrl+M did nothing.
    tui = await startTui({ mainMjs: CliRunner.DIST_BIN, home });
    await tui.press(KEYS.escape);

    const afterCtrlM = await tui.press(KEYS.ctrl('m'));
    expect(afterCtrlM).not.toMatch(/per Mtok/);

    const afterAltM = await tui.press(KEYS.alt('m'));
    expect(afterAltM).toMatch(/per Mtok/);

    // The equality `findControlCodeAliases` encodes as a rule: one byte, so no
    // handler could ever have claimed it.
    expect(KEYS.ctrl('m')).toBe(KEYS.enter);
  });
});

describe('ptah tui interaction (pty, configured workspace)', () => {
  let home: string;
  let tui: PtySession | null = null;

  beforeEach(() => {
    home = makePtyHome('ptah-pty-configured-');
  });

  afterEach(async () => {
    await tui?.dispose();
    tui = null;
    await fsp.rm(home, { recursive: true, force: true, maxRetries: 3 });
  });

  it('boots past Settings into chat when a provider and model are configured', async () => {
    tui = await startTui({
      mainMjs: CliRunner.DIST_BIN,
      home,
      workspace: process.cwd(),
      configured: { provider: 'claude', model: 'claude-sonnet-5' },
    });
    const screen = tui.screen();
    // The cold-start harness could never see this frame — it is the whole
    // reason a configured fixture exists.
    expect(screen).toMatch(/The Coding Orchestra/);
    expect(screen).not.toMatch(/Not configured/);
  });

  it('opens the sessions panel on Alt+L from a configured boot', async () => {
    tui = await startTui({
      mainMjs: CliRunner.DIST_BIN,
      home,
      workspace: process.cwd(),
      configured: { provider: 'claude', model: 'claude-sonnet-5' },
    });
    const sidebar = await tui.press(KEYS.alt('l'));
    expect(sidebar).toMatch(/Sessions/);
  });
});
