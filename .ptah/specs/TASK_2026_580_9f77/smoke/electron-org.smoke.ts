/**
 * TASK_2026_580 T1 - real Electron smoke for S1, S5, S6, S7 (RPC part).
 *
 * Runs the built dev app (dist/apps/ptah-electron) under an isolated home,
 * userData dir and PTAH_DB_PATH, so no real profile or DB is touched and no
 * credentials exist. Drives the real RPC surface through the e2e RpcBridge.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchPtah } from '../../../../apps/ptah-electron-e2e/src/support/electron-launcher';
import { RpcBridge } from '../../../../apps/ptah-electron-e2e/src/support/rpc-bridge';
import {
  REAL_BOOT_TIMEOUT_MS,
  createSeededWorkspace,
  sessionFilePath,
  waitForRpcReady,
} from '../../../../apps/ptah-electron-e2e/src/support/session-seed';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const { DatabaseSync } = require('node:sqlite') as any;

/* eslint-disable @typescript-eslint/no-explicit-any */
const N = 500;
const evidence: Record<string, unknown> = {};
const EVIDENCE_FILE = path.join(__dirname, 'results-evidence.json');

function save(key: string, value: unknown): void {
  evidence[key] = value;
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
}

async function rpc(
  bridge: RpcBridge,
  method: string,
  params: unknown,
  timeout = 60_000,
): Promise<{ success: boolean; data?: any; error?: string }> {
  return (await bridge.sendRpc(
    'rpc',
    { type: 'rpc:call', payload: { method, params } },
    timeout,
  )) as { success: boolean; data?: any; error?: string };
}

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

function readAllLogs(userDataDir: string): string {
  const out: string[] = [];
  const walkLogs = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walkLogs(f);
      else if (e.name.endsWith('.log')) out.push(fs.readFileSync(f, 'utf8'));
    }
  };
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const f = path.join(d, e.name);
      if (e.name === 'logs') walkLogs(f);
      else if (!/Cache|GPU|Storage|blob|Network/.test(e.name)) walk(f);
    }
  };
  walk(userDataDir);
  return out.join('\n');
}

function dbRows(dbPath: string, sql: string): any[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

async function boot(
  seed: ReturnType<typeof createSeededWorkspace>,
  dbPath: string,
): Promise<{ app: ElectronApplication; bridge: RpcBridge }> {
  const app = await launchPtah({
    args: [seed.workspaceRoot],
    env: { USERPROFILE: seed.home, HOME: seed.home, PTAH_DB_PATH: dbPath },
    userDataDir: seed.userDataDir,
    timeout: REAL_BOOT_TIMEOUT_MS,
  });
  const bridge = new RpcBridge(app);
  const bootStart = Date.now();
  await waitForRpcReady(bridge);
  const rpcReadyMs = Date.now() - bootStart;
  let falseSeen = 0;
  const availDeadline = Date.now() + 120_000;
  for (;;) {
    const r = await rpc(bridge, 'session:list', {
      workspacePath: seed.workspaceRoot,
      limit: 1,
    });
    if (r.data?.organizationAvailable === true) break;
    falseSeen++;
    if (Date.now() > availDeadline)
      throw new Error('organizationAvailable never became true');
    await new Promise((r2) => setTimeout(r2, 250));
  }
  const bootLog = (evidence['boots'] as unknown[] | undefined) ?? [];
  bootLog.push({
    rpcReadyMs,
    availableAfterMs: Date.now() - bootStart,
    falseResponsesBeforeAvailable: falseSeen,
  });
  save('boots', bootLog);
  return { app, bridge };
}

test('S1 S5 S6 S7 electron organization smoke', async () => {
  const seed = createSeededWorkspace();
  const dbPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-580-smoke-db-')),
    'smoke.sqlite',
  );
  const ids: string[] = [];
  const WS = seed.workspaceRoot;
  // The importer takes only the 50 newest files per scan, so seed 50 per boot.
  let app!: ElectronApplication;
  let bridge!: RpcBridge;
  const writeBatch = (round: number): void => {
    for (let i = 0; i < 50; i++) {
      const id = randomUUID();
      ids.push(id);
      fs.writeFileSync(
        sessionFilePath(seed.sessionsDir, id),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: `Smoke session ${round * 50 + i}` },
          timestamp: new Date().toISOString(),
          sessionId: id,
        }) + '\n',
      );
    }
  };
  try {
    for (let round = 0; round < N / 50; round++) {
      writeBatch(round);
      ({ app, bridge } = await boot(seed, dbPath));
      const deadline = Date.now() + 120_000;
      for (;;) {
        const r = await rpc(bridge, 'session:list', {
          workspacePath: WS,
          limit: 1,
        });
        if ((r.data?.total ?? 0) >= (round + 1) * 50) break;
        if (Date.now() > deadline)
          throw new Error(
            `round ${round}: import only reached ${r.data?.total}`,
          );
        await new Promise((r2) => setTimeout(r2, 1000));
      }
      if (round < N / 50 - 1) await app.close();
    }
    const total = (
      await rpc(bridge, 'session:list', { workspacePath: WS, limit: 1 })
    ).data.total;
    save('importedTotal', total);

    const plain = await rpc(bridge, 'session:list', {
      workspacePath: WS,
      limit: 5,
    });
    save('plainShape', {
      organizationAvailable: plain.data?.organizationAvailable,
      firstHasOrganization:
        plain.data?.sessions?.[0]?.organization !== undefined,
    });

    const statuses = ['active', 'waiting', 'in_review', 'done', 'archived'];
    const priorities = ['urgent', 'high', 'normal', 'low'];
    let expectedMatch = 0;
    for (let i = 0; i < N; i++) {
      const status = statuses[i % 5];
      const priority = priorities[i % 4];
      const r = await rpc(bridge, 'session:setOrganization', {
        sessionId: ids[i],
        status,
        priority,
        pinned: i % 50 === 0,
      });
      if (!r.success) throw new Error(`setOrganization ${i}: ${r.error}`);
      if (
        (status === 'waiting' || status === 'in_review') &&
        (priority === 'urgent' || priority === 'high')
      )
        expectedMatch++;
    }
    save('seededExpectedMatch', expectedMatch);

    const times: number[] = [];
    let last: any;
    for (let k = 0; k < 20; k++) {
      const t0 = Date.now();
      last = await rpc(bridge, 'session:list', {
        workspacePath: WS,
        limit: 50,
        status: ['waiting', 'in_review'],
        priority: ['urgent', 'high'],
        sort: 'priority',
      });
      times.push(Date.now() - t0);
    }
    const rows = last.data.sessions as any[];
    const pinnedFlags = rows.map((r) => r.organization.pinned);
    save('S1', {
      runsMs: times,
      p95Ms: p95(times),
      max: Math.max(...times),
      total: last.data.total,
      expectedTotal: expectedMatch,
      organizationAvailable: last.data.organizationAvailable,
      pageRows: rows.length,
      allStatusOk: rows.every((r) =>
        ['waiting', 'in_review'].includes(r.organization.status),
      ),
      allPriorityOk: rows.every((r) =>
        ['urgent', 'high'].includes(r.organization.priority),
      ),
      noArchived: rows.every((r) => r.organization.status !== 'archived'),
      pinnedFirst: pinnedFlags.every(
        (f, i) => i === 0 || !(f && !pinnedFlags[i - 1]),
      ),
      priorityHead: rows.slice(0, 20).map((r) => r.organization.priority),
    });
    expect(last.data.total).toBe(expectedMatch);

    const q = await rpc(bridge, 'session:list', {
      workspacePath: WS,
      limit: 1,
      pinned: false,
    });
    save('queryModeUnpinnedTotal', q.data.total);

    const target = ids[1];
    const l1 = await rpc(bridge, 'session:linkTask', {
      sessionId: target,
      taskId: 'TASK_2026_580',
      role: 'primary',
    });
    const l2 = await rpc(bridge, 'session:linkTask', {
      sessionId: target,
      taskId: 'TASK_2099_999',
      role: 'related',
    });
    save('linkTask', [l1, l2]);
    const pr = await rpc(bridge, 'session:addPrLink', {
      sessionId: target,
      url: 'https://github.com/Hive-Academy/ptah-extension/pull/623',
      state: 'draft',
    });
    save('addPrLink', pr);
    const rejected = await rpc(bridge, 'session:linkTask', {
      sessionId: target,
      taskId: 'TASK_2026_580',
      role: 'primary',
      source: 'agent',
    });
    save('webviewAgentSourceRejected', rejected);
    const lft = await rpc(bridge, 'session:listForTasks', {
      workspacePath: WS,
    });
    save('listForTasks', lft);
    const withTasks = (
      await rpc(bridge, 'session:list', {
        workspacePath: WS,
        limit: 500,
        taskId: 'TASK_2026_580',
      })
    ).data.sessions[0];
    save('S6_missingTaskFlags', withTasks?.organization?.tasks);
    save('rowBeforeRestart', withTasks?.organization);

    const rn = await rpc(bridge, 'session:rename', {
      sessionId: target,
      name: 'Smoke renamed',
    });
    save('rename', rn);

    await app.close();
    ({ app, bridge } = await boot(seed, dbPath));
    fs.appendFileSync(
      sessionFilePath(seed.sessionsDir, target),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'again' },
        timestamp: new Date().toISOString(),
        sessionId: target,
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 5000));
    const after = await rpc(bridge, 'session:list', {
      workspacePath: WS,
      limit: 500,
      taskId: 'TASK_2026_580',
    });
    const rowAfter = after.data.sessions[0];
    save('rowAfterRestart', rowAfter?.organization);
    save('S5_nameAfterRestart', rowAfter?.name);
    expect(rowAfter.organization.priority).toBe('high');
    expect(rowAfter.organization.status).toBe('waiting');
    expect(rowAfter.organization.prLinks.length).toBe(1);
    expect(rowAfter.organization.tasks.length).toBe(2);
    const stillTotal = await rpc(bridge, 'session:list', {
      workspacePath: WS,
      limit: 1,
      status: ['waiting', 'in_review'],
      priority: ['urgent', 'high'],
      sort: 'priority',
    });
    expect(stillTotal.data.total).toBe(expectedMatch);

    // R-TL12 orphan probe: organization row for an id with no metadata
    save('step', 'closing app before orphan probe');
    await app.close();
    save('step', 'app closed; opening db');
    const orphanId = randomUUID();
    const wdb = new DatabaseSync(dbPath);
    const cols = wdb
      .prepare('PRAGMA table_info(session_organization)')
      .all()
      .map((c: any) => c.name);
    save('orgColumns', cols);
    save(
      'taskLinkColumns',
      wdb
        .prepare('PRAGMA table_info(session_task_links)')
        .all()
        .map((c: any) => c.name),
    );
    save(
      'prLinkColumns',
      wdb
        .prepare('PRAGMA table_info(session_pr_links)')
        .all()
        .map((c: any) => c.name),
    );
    const src = wdb
      .prepare('SELECT * FROM session_organization WHERE session_id = ?')
      .get(target) as any;
    if (src) {
      const copy = {
        ...src,
        session_id: orphanId,
        priority: 'urgent',
        status: 'waiting',
      };
      const keys = Object.keys(copy);
      wdb
        .prepare(
          `INSERT INTO session_organization (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        )
        .run(...keys.map((k) => copy[k]));
    }
    wdb.close();
    save('step', 'orphan inserted; rebooting');
    ({ app, bridge } = await boot(seed, dbPath));
    save('step', 'rebooted');
    const orphanList = await rpc(bridge, 'session:list', {
      workspacePath: WS,
      limit: 500,
      status: ['waiting'],
      priority: ['urgent'],
    });
    save('R_TL12', {
      orphanSeeded: !!src,
      orphanInRows: orphanList.data.sessions.some(
        (s: any) => s.id === orphanId,
      ),
      total: orphanList.data.total,
    });
    expect(orphanList.data.sessions.some((s: any) => s.id === orphanId)).toBe(
      false,
    );

    save('step', 'deleting');
    const del = await rpc(bridge, 'session:delete', { sessionId: target });
    save('S6_delete', del);
    await new Promise((r) => setTimeout(r, 3000));
    await app.close();
    save('S6_rowsAfterDelete', {
      org: dbRows(
        dbPath,
        `SELECT count(*) AS c FROM session_organization WHERE session_id='${target}'`,
      )[0],
      tasks: dbRows(
        dbPath,
        `SELECT count(*) AS c FROM session_task_links WHERE session_id='${target}'`,
      )[0],
      prs: dbRows(
        dbPath,
        `SELECT count(*) AS c FROM session_pr_links WHERE session_id='${target}'`,
      )[0],
      otherOrgRows: dbRows(
        dbPath,
        'SELECT count(*) AS c FROM session_organization',
      )[0],
    });
    const logs = readAllLogs(seed.userDataDir);
    save('logs', {
      sessionOrganizationLines: logs
        .split('\n')
        .filter((l) => l.includes('[SessionOrganization]'))
        .slice(0, 60),
      errorLines: logs
        .split('\n')
        .filter((l) =>
          /could not read organization|organization.*(ERROR|failed)/i.test(l),
        )
        .slice(0, 10),
      slowListLines: logs
        .split('\n')
        .filter((l) => /session:list took/.test(l)),
    });
  } finally {
    await app.close().catch(() => undefined);
    seed.cleanup();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});
