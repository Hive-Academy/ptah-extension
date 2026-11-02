/**
 * `harness:*-install-migration-notice` handler spec (TASK_2026_853 Phase D,
 * implementation-plan D-6 step 5, decision #16).
 *
 * The real `InstallScopeMigrationService` reads and writes a ledger under a
 * temp home; each case writes the ledger state it needs. Calls go through the
 * mock RPC handler's `handleMessage`, so the result is what a webview sees.
 */

import 'reflect-metadata';

import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

// The agent-generation barrel (reached through the service) loads
// workspace-intelligence, whose tree-sitter module cannot load under Jest's
// CJS transform; the shared stub keeps the module graph short of it.
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type {
  HarnessDismissInstallMigrationNoticeResult,
  HarnessGetInstallMigrationNoticeResult,
} from '@ptah-extension/shared';

import {
  InstallScopeMigrationService,
  installScopeLedgerPath,
  type InstallScopeLedger,
} from './install-scope-migration.service';
import {
  INSTALL_MIGRATION_NOTICE_DISMISS_ERROR,
  INSTALL_MIGRATION_NOTICE_INVALID_ERROR,
  InstallScopeNoticeRpcHandlers,
} from './install-scope-notice-rpc.handlers';

const GET = 'harness:get-install-migration-notice';
const DISMISS = 'harness:dismiss-install-migration-notice';

let home: string;
let logger: MockLogger;
let rpc: MockRpcHandler;
let service: InstallScopeMigrationService;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(tmpdir(), 'ptah-notice-rpc-'));
  logger = createMockLogger();
  rpc = createMockRpcHandler();
  service = new InstallScopeMigrationService(
    logger as unknown as Logger,
    {
      reconcile: async () => {
        throw new Error('reconcile is not used by the notice RPCs');
      },
    },
    { list: async () => [] },
    { getWorkspaceFolders: () => [] },
    home,
    {
      reapRetired: async () => {
        throw new Error('the reaper is not used by the notice RPCs');
      },
    },
    { listRetired: () => [] },
  );
  new InstallScopeNoticeRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    service,
  ).register();
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

async function call(method: string, params: unknown = {}) {
  return rpc.handleMessage({ method, params, correlationId: 'c1' });
}

async function writeLedger(ledger: InstallScopeLedger): Promise<void> {
  const file = installScopeLedgerPath(home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(ledger), 'utf8');
}

async function readLedgerFile(): Promise<InstallScopeLedger> {
  return JSON.parse(await fs.readFile(installScopeLedgerPath(home), 'utf8'));
}

const W1 = '/work/w1/.mcp.json#mcpServers.S';
const W2 = '/work/w2/.mcp.json#mcpServers.S';
const KEPT = '/work/w1/.claude/skills/kept-skill';

/** A completed run: one v1 MCP server removed from two workspaces and one
 * skills.sh root retired but left on disk with one kept workspace copy. */
function completedLedger(): InstallScopeLedger {
  return {
    version: 1,
    discoveredAt: '2026-10-31T09:00:00.000Z',
    items: {
      'mcp:S': {
        kind: 'mcp',
        retired: true,
        removedPaths: {
          [W1]: '2026-10-31T09:01:00.000Z',
          [W2]: '2026-10-31T09:02:00.000Z',
        },
        keptPaths: {},
        failedPaths: {},
      },
      'skills-sh:abc123': {
        kind: 'skills-sh',
        retired: true,
        onDisk: path.join(home, '.ptah', 'plugins', 'ptah-skillssh-abc123'),
        onDiskReason: 'marker-missing',
        removedPaths: {},
        keptPaths: { [KEPT]: 'edited' },
        failedPaths: {},
      },
    },
    workspaces: {
      w1: { root: '/work/w1', passedAt: '2026-10-31T09:01:00.000Z' },
      w2: { root: '/work/w2', passedAt: '2026-10-31T09:02:00.000Z' },
    },
    completedAt: '2026-10-31T09:03:00.000Z',
  };
}

describe('InstallScopeNoticeRpcHandlers', () => {
  it('declares exactly the two notice methods', () => {
    expect(InstallScopeNoticeRpcHandlers.METHODS).toEqual([GET, DISMISS]);
    expect(rpc.getRegisteredMethods().sort()).toEqual([DISMISS, GET].sort());
  });

  describe(GET, () => {
    it('returns a null notice when no ledger exists yet', async () => {
      const res = await call(GET);
      expect(res.success).toBe(true);
      expect(res.data).toEqual({ notice: null });
    });

    it('returns a null notice before the migration completed', async () => {
      const ledger = completedLedger();
      delete ledger.completedAt;
      await writeLedger(ledger);

      const res = await call(GET);
      expect(res.data).toEqual({ notice: null });
    });

    it('returns the persisted notice mapped to the shared contract', async () => {
      await writeLedger(completedLedger());

      const res = await call(GET);
      expect(res.success).toBe(true);
      const data = res.data as HarnessGetInstallMigrationNoticeResult;
      expect(data.notice).toEqual({
        counts: { retired: 2, deleted: 2, kept: 1, onDisk: 1 },
        keptPaths: [KEPT],
        onDisk: [
          {
            kind: 'skills-sh-root',
            name: 'abc123',
            path: path.join(home, '.ptah', 'plugins', 'ptah-skillssh-abc123'),
          },
        ],
      });
    });

    it('shows a retired-only run (decision #16)', async () => {
      await writeLedger({
        version: 1,
        items: {
          'mcp:only': {
            kind: 'mcp',
            retired: true,
            removedPaths: {},
            keptPaths: {},
            failedPaths: {},
          },
        },
        workspaces: {},
        completedAt: '2026-10-31T09:03:00.000Z',
      });

      const data = (await call(GET))
        .data as HarnessGetInstallMigrationNoticeResult;
      expect(data.notice).toEqual({
        counts: { retired: 1, deleted: 0, kept: 0, onDisk: 0 },
        keptPaths: [],
        onDisk: [],
      });
    });

    it('refuses non-empty params with fixed copy', async () => {
      const res = await call(GET, { workspaceRoot: '/x' });
      expect(res).toMatchObject({
        success: false,
        error: INSTALL_MIGRATION_NOTICE_INVALID_ERROR,
        errorCode: 'INVALID_PARAMS',
      });
    });
  });

  describe(DISMISS, () => {
    it('persists noticeSeenAt and hides the notice afterwards', async () => {
      await writeLedger(completedLedger());
      expect(
        ((await call(GET)).data as HarnessGetInstallMigrationNoticeResult)
          .notice,
      ).not.toBeNull();

      const res = await call(DISMISS);
      expect(res.success).toBe(true);
      expect(res.data).toEqual({
        success: true,
      } satisfies HarnessDismissInstallMigrationNoticeResult);
      expect(typeof (await readLedgerFile()).noticeSeenAt).toBe('string');
      expect((await call(GET)).data).toEqual({ notice: null });
    });

    it('reports success false when there is no ledger to dismiss', async () => {
      const res = await call(DISMISS);
      expect(res.success).toBe(true);
      expect(res.data).toEqual({ success: false });
    });

    it('maps a real ledger failure to fixed copy and logs the cause', async () => {
      // The ledger path is a directory: reading it fails with EISDIR.
      await fs.mkdir(installScopeLedgerPath(home), { recursive: true });

      const res = await call(DISMISS);
      expect(res).toMatchObject({
        success: false,
        error: INSTALL_MIGRATION_NOTICE_DISMISS_ERROR,
        errorCode: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'RPC: harness:dismiss-install-migration-notice failed',
        expect.any(Error),
      );
    });

    it('never forwards raw fs error text or paths to the caller', async () => {
      const raw = `EACCES: permission denied, open '${installScopeLedgerPath(home)}'`;
      jest.spyOn(service, 'dismissNotice').mockRejectedValue(new Error(raw));

      const res = await call(DISMISS);
      expect(res.success).toBe(false);
      expect(res.error).toBe(INSTALL_MIGRATION_NOTICE_DISMISS_ERROR);
      expect(res.error).not.toContain('EACCES');
      expect(res.error).not.toContain(home);
      expect(logger.error).toHaveBeenCalledWith(
        'RPC: harness:dismiss-install-migration-notice failed',
        expect.objectContaining({ message: raw }),
      );
    });

    it('refuses non-empty params before touching the ledger', async () => {
      await writeLedger(completedLedger());
      const res = await call(DISMISS, { force: true });
      expect(res).toMatchObject({
        success: false,
        errorCode: 'INVALID_PARAMS',
      });
      expect((await readLedgerFile()).noticeSeenAt).toBeUndefined();
    });
  });
});
