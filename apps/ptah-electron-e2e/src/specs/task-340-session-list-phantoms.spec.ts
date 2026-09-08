import * as fs from 'fs';
import { test, expect } from '@playwright/test';
import { RpcBridge } from '../support/rpc-bridge';
import {
  REAL_BOOT_TIMEOUT_MS,
  createSeededWorkspace,
  launchSeeded,
  listSessions,
  sessionFilePath,
  waitForRpcReady,
  waitForSessions,
  writeSidecarOnly,
  writeTitledSession,
  writeUntitledSession,
  writeWhitespaceOnly,
  type SeededWorkspace,
} from '../support/session-seed';

/**
 * TASK_2026_340 — the session list must not show a phantom `Session <date>`
 * row for a file that never held a conversation, a phantom row minted by an
 * earlier build must disappear on the next scan, and a REAL session whose
 * title extraction yielded nothing must still be listed.
 *
 * This one is fully observable: it is a BACKEND behaviour, and the whole path
 * — `SessionImporterService.findSessionsDirectory` -> `extractMetadata` ->
 * `pruneTitleOnlySessions` -> the `session:list` RPC handler — runs inside the
 * real app. Nothing is mocked here; the specs seed real files under an
 * isolated `os.homedir()` and read the real handler's answer through the RPC
 * bridge.
 *
 * Four seeded shapes, one per branch of the rule:
 *
 * - R — a real session whose first user message carries text. Listed under
 *   that text.
 * - N — a real session whose first user message yields NO text. Listed under
 *   the `Session <date>` fallback. This is the row a NAME-based prune would
 *   destroy, so it is the guard that makes the prune assertions meaningful.
 * - W — whitespace only. Never a session.
 * - S — a standalone CLI metadata sidecar (`ai-title`). Never a session.
 *
 * Test 1 covers the producer (`extractMetadata` refuses W and S). Test 2
 * covers the prune: two launches sharing one home and one `--user-data-dir`,
 * with two rows that WERE real conversations at import time overwritten into
 * contentless files in between — which is exactly the state a store carries
 * when phantoms were minted before TASK_2026_308 shipped.
 *
 * Falsifiability: each assertion pair states both directions. "W is absent"
 * alone would pass against a handler that returned nothing at all, so every
 * test also asserts that R and N ARE present, by id and by name, in the same
 * response.
 */

test.describe('Session list phantoms (TASK_2026_340)', () => {
  test.setTimeout(240_000);

  test('a whitespace-only and a sidecar-only JSONL never enter the session list, while a titled session and an untitled real session both do', async () => {
    const seed: SeededWorkspace = createSeededWorkspace();
    const realTitle = 'PTAH_E2E_REAL_TITLE first user message';
    const realId = writeTitledSession(seed.sessionsDir, realTitle);
    const untitledId = writeUntitledSession(seed.sessionsDir);
    const whitespaceId = writeWhitespaceOnly(seed.sessionsDir);
    const sidecarId = writeSidecarOnly(seed.sessionsDir);

    const app = await launchSeeded(seed);
    try {
      const window = await app.firstWindow({ timeout: REAL_BOOT_TIMEOUT_MS });
      await window.waitForLoadState('domcontentloaded');
      const bridge = new RpcBridge(app);
      await waitForRpcReady(bridge);

      // The boot scan runs after the window opens and nothing a spec can see
      // awaits it, so poll until both real sessions have landed.
      const sessions = await waitForSessions(
        bridge,
        seed.workspaceRoot,
        (rows) =>
          rows.some((s) => s.id === realId) &&
          rows.some((s) => s.id === untitledId),
      );

      const byId = new Map(sessions.map((s) => [s.id, s]));

      // The two real sessions, both directions of the name rule.
      expect(byId.get(realId)?.name).toContain('PTAH_E2E_REAL_TITLE');
      expect(byId.get(untitledId)?.name).toMatch(/^Session /);

      // The two contentless files. Asserted in the SAME response that just
      // proved the scan ran, so absence here is a refusal and not a
      // not-yet-imported race.
      expect(byId.has(whitespaceId)).toBe(false);
      expect(byId.has(sidecarId)).toBe(false);

      // Give the scan room to do anything further it might have queued, then
      // re-read. A phantom that arrives late is still a phantom.
      await window.waitForTimeout(3_000);
      const settled = await listSessions(bridge, seed.workspaceRoot);
      const settledIds = new Set(settled.map((s) => s.id));
      expect(settledIds.has(whitespaceId)).toBe(false);
      expect(settledIds.has(sidecarId)).toBe(false);
      expect(settledIds.has(realId)).toBe(true);
      expect(settledIds.has(untitledId)).toBe(true);
    } finally {
      await app.close().catch(() => undefined);
      seed.cleanup();
    }
  });

  test('rows whose backing file became contentless are pruned on the next scan, and a real session named "Session <date>" survives it', async () => {
    const seed: SeededWorkspace = createSeededWorkspace();
    const realTitle = 'PTAH_E2E_REAL_TITLE survivor';
    const realId = writeTitledSession(seed.sessionsDir, realTitle);
    const untitledId = writeUntitledSession(seed.sessionsDir);
    // P and Q are real conversations at import time. They become phantoms
    // between the two launches.
    const phantomSidecarId = writeTitledSession(
      seed.sessionsDir,
      'PTAH_E2E_SOON_SIDECAR',
    );
    const phantomBlankId = writeTitledSession(
      seed.sessionsDir,
      'PTAH_E2E_SOON_BLANK',
    );

    // --- Launch 1: import all four, confirm every row is stored ----------
    const firstApp = await launchSeeded(seed);
    try {
      const window = await firstApp.firstWindow({
        timeout: REAL_BOOT_TIMEOUT_MS,
      });
      await window.waitForLoadState('domcontentloaded');
      const bridge = new RpcBridge(firstApp);
      await waitForRpcReady(bridge);

      const sessions = await waitForSessions(
        bridge,
        seed.workspaceRoot,
        (rows) => {
          const ids = new Set(rows.map((s) => s.id));
          return (
            ids.has(realId) &&
            ids.has(untitledId) &&
            ids.has(phantomSidecarId) &&
            ids.has(phantomBlankId)
          );
        },
      );
      expect(sessions.length).toBeGreaterThanOrEqual(4);
    } finally {
      await firstApp.close().catch(() => undefined);
    }

    // --- Between launches: both backing files become contentless --------
    writeSidecarOnly(seed.sessionsDir, phantomSidecarId);
    writeWhitespaceOnly(seed.sessionsDir, phantomBlankId);
    // Sanity-check the edit landed, so a prune assertion cannot pass because
    // the file was never rewritten.
    expect(
      fs.readFileSync(
        sessionFilePath(seed.sessionsDir, phantomBlankId),
        'utf8',
      ),
    ).toBe('\n  \n');

    // --- Launch 2: same home, same user-data-dir, same workspace ---------
    const secondApp = await launchSeeded(seed);
    try {
      const window = await secondApp.firstWindow({
        timeout: REAL_BOOT_TIMEOUT_MS,
      });
      await window.waitForLoadState('domcontentloaded');
      const bridge = new RpcBridge(secondApp);
      await waitForRpcReady(bridge);

      const pruned = await waitForSessions(
        bridge,
        seed.workspaceRoot,
        (rows) => {
          const ids = new Set(rows.map((s) => s.id));
          return !ids.has(phantomSidecarId) && !ids.has(phantomBlankId);
        },
      );

      const byId = new Map(pruned.map((s) => [s.id, s]));
      expect(byId.has(phantomSidecarId)).toBe(false);
      expect(byId.has(phantomBlankId)).toBe(false);

      // The name-heuristic guard: the untitled real session is called
      // `Session <date>`, the same name every phantom carried, and it must
      // still be here.
      expect(byId.get(untitledId)?.name).toMatch(/^Session /);
      expect(byId.get(realId)?.name).toContain('PTAH_E2E_REAL_TITLE');
    } finally {
      await secondApp.close().catch(() => undefined);
      seed.cleanup();
    }
  });
});
