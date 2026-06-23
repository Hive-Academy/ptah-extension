import * as os from 'os';
import { test, expect } from '../../support/fixtures';
import {
  readInvocationStatsViaRpc,
  readRawSkillEventsBySlug,
  waitForInvocation,
} from '../../support/skill-telemetry-db';

/**
 * P0 skill-invocation telemetry smoke (closes deferred §4 / §12 of
 * `.ptah/specs/TASK_2026_THOTH_SKILL_CLONE_ENHANCE/test-plan.md`).
 *
 * Verifies the end-to-end production telemetry path on a REAL running Electron
 * app: invoking a skill writes a row to `skill_invocation_events` (migration
 * 0021) with the BARE slug and a non-null `context_id`.
 *
 * Pipeline exercised (all production code, no test doubles):
 *   chat:start `/caveman …`  → SDK model turn → `Skill` tool-use
 *     → SDK PostToolUse hook (`PostToolUseHookHandler.createHooks`)
 *     → `PostToolUseCallbackRegistry.notifyAll`
 *     → `SkillTriggerService.onPostToolUse` (toolName === 'Skill')
 *     → `extractSkillSlug` (strips leading '/')
 *     → `SkillInvocationRecorder.recordSkillEvent`
 *     → `SkillCandidateStore.recordSkillEvent`  (INSERT skill_invocation_events)
 *   Read-back: `skillSynthesis:invocationStats` RPC → `getInvocationStats(slug)`.
 *
 * ── Why this is gated / CI-skippable ──────────────────────────────────────
 * The write half of the pipeline is fed by the SDK `PostToolUse` hook, which
 * only fires during a real model turn. The DI container that owns the callback
 * registry is module-scoped inside the packed `main.mjs` and is NOT reachable
 * from Playwright's `electronApp.evaluate()` (the same limitation documented in
 * `license-watcher.spec.ts`). There is no production RPC that records a skill
 * event directly. So the only honest, non-instrumented trigger is a real
 * `/caveman` turn — which needs provider auth and a network round-trip, and is
 * therefore flaky/unsuitable for headless CI.
 *
 * This spec runs ONLY when `PTAH_E2E_SKILL_TELEMETRY=1` is set (which the
 * operator sets on a Windows box with a configured provider). It is also tagged
 * `@nightly` so the default `nx e2e ptah-electron-e2e` run never selects it.
 *
 * ── Windows relevance (GH #57250) ────────────────────────────────────────
 * GH #57250 is a Windows+GitBash slash-from-command-body payload quirk. The
 * telemetry SQL path itself is cross-platform, but the regression this guards
 * (slug recorded despite the Windows payload shape) is Windows-specific, so the
 * spec is win32-gated.
 */

const TELEMETRY_ENABLED = process.env['PTAH_E2E_SKILL_TELEMETRY'] === '1';
const IS_WIN32 = os.platform() === 'win32';

// Bare slug as stored by the recorder (no leading '/', no `ptah-` prefix).
const SKILL_SLUG = 'caveman';

test.describe('@nightly Thoth — skill-invocation telemetry (P0)', () => {
  test.skip(
    !TELEMETRY_ENABLED,
    'Requires a real model turn + provider auth; set PTAH_E2E_SKILL_TELEMETRY=1 ' +
      'to run on a Windows box with a configured provider.',
  );
  test.skip(
    !IS_WIN32,
    'Windows-only smoke (GH #57250 slash-from-command-body payload quirk).',
  );

  // A real /caveman turn streams a full assistant response; allow generous time.
  test.setTimeout(180_000);

  test('invoking /caveman records a skill_invocation_events row with bare slug + context_id', async ({
    electronApp,
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');

    // Baseline: capture the existing row count for this slug. The DB is the
    // shared real ~/.ptah/state/ptah.sqlite, so prior runs may have rows.
    const before = await readInvocationStatsViaRpc(rpcBridge, SKILL_SLUG);
    if (before === null) {
      throw new Error(
        'skillSynthesis:invocationStats RPC unavailable — telemetry read path ' +
          'not wired in this build; cannot verify.',
      );
    }
    const baselineTotal = before.total;

    // Drive a REAL skill invocation through the production chat path. The
    // prompt body is itself the slash-skill, exercising the GH #57250 shape.
    const tabId = `e2e-telemetry-${Date.now()}`;
    const startRes = (await rpcBridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: {
          method: 'chat:start',
          params: {
            tabId,
            prompt: `/${SKILL_SLUG} say hi in one short line`,
            workspacePath: process.cwd(),
          },
        },
      },
      30_000,
    )) as { success?: boolean; error?: string; errorCode?: string };

    if (startRes?.success !== true) {
      throw new Error(
        `chat:start failed (errorCode=${startRes?.errorCode ?? 'n/a'}, ` +
          `error=${startRes?.error ?? 'n/a'}). A configured provider is ` +
          'required to run this telemetry smoke.',
      );
    }

    // Poll the real read RPC until the telemetry row lands (the model turn +
    // PostToolUse hook fan-out is asynchronous).
    const after = await waitForInvocation(
      rpcBridge,
      electronApp,
      SKILL_SLUG,
      150_000,
    );
    expect(after, 'invocationStats RPC must remain readable').not.toBeNull();
    const afterTotal = after?.total ?? -1;
    expect(
      afterTotal,
      'a new skill_invocation_events row must be recorded for the bare slug',
    ).toBeGreaterThan(baselineTotal);

    // Secondary (best-effort) assertion: inspect the raw row columns the stats
    // aggregate hides. better-sqlite3 here is built for the Electron ABI, so a
    // direct read from the Playwright Node process may be impossible — treat a
    // null return as "skip the raw check", NOT a failure.
    const rawRows = readRawSkillEventsBySlug(SKILL_SLUG);
    if (rawRows !== null) {
      expect(rawRows.length, 'raw rows present for slug').toBeGreaterThan(0);
      const newest = rawRows[0];
      // Bare slug — no leading '/', no `ptah-` prefix.
      expect(newest.skill_slug).toBe(SKILL_SLUG);
      // context_id is the workspace fingerprint and must be non-null.
      expect(
        newest.context_id,
        'context_id must be the workspace fingerprint (non-null)',
      ).not.toBeNull();
      expect((newest.context_id ?? '').length).toBeGreaterThan(0);
      // Tool-use is the source for a real /caveman turn.
      expect(newest.source).toBe('tool-use');
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'Raw better-sqlite3 read unavailable (Electron-ABI native module) — ' +
          'verified via skillSynthesis:invocationStats RPC only.',
      });
    }
  });
});
