/**
 * attention specs: one table per source (harness, connections, session,
 * blocked removals), the de-duplication of a session item behind a connection
 * item, ordering, and the rule that nothing outside the four sources — no
 * healthy state, no forecast — ever produces an item.
 */

import type {
  HarnessHealthSummary,
  HarnessTargetHealth,
  HarnessTargetId,
  SessionMcpServerEntry,
  SmitheryConnectionStatus,
  SmitheryConnectionSummary,
} from '@ptah-extension/shared';
import {
  needsAttention,
  type NeedsAttentionInputs,
  type NeedsAttentionItem,
} from './attention';
import type { ProviderRow } from './provider-row';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function row(title: string, overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    ref: `harness-config:${title}`,
    serverKey: title,
    kind: 'config',
    title,
    brand: null,
    origin: 'harness-config',
    originLabel: 'Config file',
    targets: [],
    status: 'configured',
    statusSource: 'config',
    connection: null,
    removal: { kind: 'uninstall' },
    configSummary: {
      transport: 'stdio',
      command: 'npx',
      args: [],
      envKeys: [],
    },
    configPaths: [],
    ...overrides,
  };
}

function oauthRow(
  title: string,
  state: 'connected' | 'expired' | 'disconnected',
): ProviderRow {
  return row(title, {
    ref: `oauth:${title}`,
    kind: 'connection',
    origin: 'oauth',
    originLabel: 'OAuth',
    connection: { source: 'oauth', state },
    removal: { kind: 'disconnect' },
  });
}

function smitheryRow(serverKey: string): ProviderRow {
  return row(serverKey, {
    ref: `smithery:${serverKey}`,
    kind: 'connection',
    origin: 'smithery',
    originLabel: 'Smithery',
    removal: { kind: 'disconnect' },
  });
}

function connection(
  connectionId: string,
  status: SmitheryConnectionStatus,
  serverKey?: string,
): SmitheryConnectionSummary {
  return {
    connectionId,
    name: `Connection ${connectionId}`,
    status,
    managedByPtah: serverKey !== undefined,
    ...(serverKey === undefined ? {} : { serverKey }),
  };
}

function harnessTarget(
  target: HarnessTargetId,
  overrides: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target,
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    },
    expected: 4,
    found: 4,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 1,
    ...overrides,
  };
}

function summary(
  level: HarnessHealthSummary['level'],
  label = 'label',
): HarnessHealthSummary {
  return {
    level,
    detectedTargets: 1,
    expected: 4,
    found: 4,
    missing: 0,
    writeFailed: 0,
    foreign: 0,
    removed: 0,
    collisions: 0,
    sources: 'ok',
    label,
  };
}

function inputs(
  overrides: Partial<NeedsAttentionInputs>,
): NeedsAttentionInputs {
  return {
    rows: [],
    harness: null,
    smitheryConnections: [],
    sessionServers: [],
    ...overrides,
  };
}

const brief = (items: readonly NeedsAttentionItem[]) =>
  items.map(({ id, severity, target }) => ({ id, severity, target }));

// ── Nothing to report ─────────────────────────────────────────────────────────

describe('needsAttention — quiet inputs', () => {
  it('reports nothing for healthy, connected, removable rows', () => {
    expect(
      needsAttention(
        inputs({
          rows: [
            row('ptah'),
            oauthRow('sentry', 'connected'),
            row('Gmail', {
              ref: 'claude-connector:Gmail',
              kind: 'account-connector',
              origin: 'claude-connector',
              removal: { kind: 'manage-link', reason: 'Managed in claude.ai.' },
            }),
          ],
          harness: {
            summary: summary('ok'),
            targets: [harnessTarget('claude')],
          },
          smitheryConnections: [connection('c1', 'connected', 'exa')],
          sessionServers: [
            { name: 'ptah', status: 'connected' },
            { name: 'x', status: 'pending' },
            { name: 'y', status: 'disabled' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('reports nothing for an unknown harness summary (no reconcile yet)', () => {
    expect(
      needsAttention(
        inputs({ harness: { summary: summary('unknown'), targets: [] } }),
      ),
    ).toEqual([]);
  });
});

// ── 1. Harness ────────────────────────────────────────────────────────────────

describe('needsAttention — harness', () => {
  it.each<[string, HarnessTargetHealth, string, 'error' | 'warning']>([
    [
      'missing entries',
      harnessTarget('codex', { missing: ['a', 'b'] }),
      '2 missing',
      'warning',
    ],
    [
      'failed writes',
      harnessTarget('cursor', {
        writeFailed: [{ relPath: 'x', reason: 'EPERM' }],
        missing: ['x'],
      }),
      '1 could not be written · 1 missing',
      'error',
    ],
    [
      'overwritten local edits',
      harnessTarget('claude', { overwrittenLocalEdit: ['CLAUDE.md'] }),
      '1 local edits replaced',
      'warning',
    ],
  ])('flags a target with %s', (_case, target, detail, severity) => {
    const [item] = needsAttention(
      inputs({ harness: { summary: summary('degraded'), targets: [target] } }),
    );
    expect(item).toMatchObject({
      id: `harness:${target.target}`,
      source: 'harness',
      severity,
      detail,
      target: { kind: 'harness' },
    });
  });

  it('ignores an undetected target', () => {
    expect(
      needsAttention(
        inputs({
          harness: {
            summary: summary('ok'),
            targets: [
              harnessTarget('codex', { detected: false, missing: ['a'] }),
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  it.each<['degraded' | 'error', 'warning' | 'error']>([
    ['degraded', 'warning'],
    ['error', 'error'],
  ])(
    'falls back to one summary item for a %s level with no flagged target',
    (level, severity) => {
      expect(
        needsAttention(
          inputs({
            harness: {
              summary: summary(level, 'Harness sources not installed yet'),
              targets: [harnessTarget('claude')],
            },
          }),
        ),
      ).toEqual([
        {
          id: 'harness:summary',
          source: 'harness',
          severity,
          title: 'Harness sync needs attention',
          detail: 'Harness sources not installed yet',
          target: { kind: 'harness' },
        },
      ]);
    },
  );
});

// ── 2. Connections ────────────────────────────────────────────────────────────

describe('needsAttention — connections', () => {
  it.each<['expired' | 'disconnected', string]>([
    ['expired', 'The sign-in expired.'],
    ['disconnected', 'The OAuth connection is disconnected.'],
  ])('flags an OAuth row whose state is %s', (state, detail) => {
    expect(
      needsAttention(inputs({ rows: [oauthRow('sentry', state)] })),
    ).toEqual([
      {
        id: 'oauth:oauth:sentry',
        source: 'connection',
        severity: 'warning',
        title: 'sentry needs to reconnect',
        detail,
        target: { kind: 'server', ref: 'oauth:sentry' },
      },
    ]);
  });

  it('reads the live OAuth state, not the session-derived status', () => {
    const expiredButReported = {
      ...oauthRow('sentry', 'expired'),
      status: 'connected' as const,
      statusSource: 'session' as const,
    };
    expect(
      needsAttention(inputs({ rows: [expiredButReported] })).map(
        (item) => item.id,
      ),
    ).toEqual(['oauth:oauth:sentry']);
  });

  it.each<[SmitheryConnectionStatus, 'error' | 'warning']>([
    ['disconnected', 'warning'],
    ['auth_required', 'warning'],
    ['input_required', 'warning'],
    ['error', 'error'],
    ['unknown', 'warning'],
  ])('flags a Smithery connection that is %s', (status, severity) => {
    const [item] = needsAttention(
      inputs({ smitheryConnections: [connection('c1', status)] }),
    );
    expect(item).toMatchObject({
      id: 'smithery:c1',
      source: 'connection',
      severity,
      title: 'Connection c1',
    });
  });

  it('links a Ptah-managed Smithery connection to its row, any other to the source', () => {
    expect(
      brief(
        needsAttention(
          inputs({
            rows: [smitheryRow('exa')],
            smitheryConnections: [
              connection('mine', 'auth_required', 'exa'),
              connection('theirs', 'auth_required'),
              connection('orphan', 'auth_required', 'gone'),
            ],
          }),
        ),
      ),
    ).toEqual([
      {
        id: 'smithery:mine',
        severity: 'warning',
        target: { kind: 'server', ref: 'smithery:exa' },
      },
      {
        id: 'smithery:theirs',
        severity: 'warning',
        target: { kind: 'smithery' },
      },
      {
        id: 'smithery:orphan',
        severity: 'warning',
        target: { kind: 'smithery' },
      },
    ]);
  });
});

// ── 3. Session ────────────────────────────────────────────────────────────────

describe('needsAttention — session', () => {
  it.each<[string, SessionMcpServerEntry, string, 'error' | 'warning']>([
    [
      'failed',
      { name: 'ptah', status: 'failed' },
      'ptah failed to start',
      'error',
    ],
    [
      'needs-auth',
      { name: 'ptah', status: 'needs-auth' },
      'ptah needs sign-in',
      'warning',
    ],
  ])('flags a %s server', (_case, entry, title, severity) => {
    expect(
      needsAttention(inputs({ rows: [row('ptah')], sessionServers: [entry] })),
    ).toEqual([
      {
        id: 'session:ptah',
        source: 'session',
        severity,
        title,
        detail: 'Reported by the most recent session.',
        target: { kind: 'server', ref: 'harness-config:ptah' },
      },
    ]);
  });

  it('links to the row the session status was applied to', () => {
    const rows = [
      row('github', { targets: [] }),
      row('github', {
        ref: 'claude-user:github',
        origin: 'claude-user',
        status: 'failed',
        statusSource: 'session',
      }),
    ];
    const [item] = needsAttention(
      inputs({ rows, sessionServers: [{ name: 'GitHub', status: 'failed' }] }),
    );
    expect(item.target).toEqual({ kind: 'server', ref: 'claude-user:github' });
  });

  it('links to the server list when several rows share the key and none owns the report', () => {
    const rows = [
      row('github', { targets: [] }),
      row('github', { ref: 'claude-user:github', origin: 'claude-user' }),
    ];
    const [item] = needsAttention(
      inputs({ rows, sessionServers: [{ name: 'github', status: 'failed' }] }),
    );
    expect(item.target).toEqual({ kind: 'servers' });
  });

  it('links to the server list when no row matches', () => {
    const [item] = needsAttention(
      inputs({ sessionServers: [{ name: 'ghost', status: 'failed' }] }),
    );
    expect(item.target).toEqual({ kind: 'servers' });
  });

  it('reports a repeated server once', () => {
    expect(
      needsAttention(
        inputs({
          sessionServers: [
            { name: 'ptah', status: 'failed' },
            { name: 'PTAH', status: 'needs-auth' },
          ],
        }),
      ).map((item) => item.id),
    ).toEqual(['session:ptah']);
  });

  it('drops a session item for a server a connection item already names', () => {
    const items = needsAttention(
      inputs({
        rows: [oauthRow('sentry', 'expired')],
        sessionServers: [{ name: 'sentry', status: 'needs-auth' }],
      }),
    );
    expect(items.map((item) => item.id)).toEqual(['oauth:oauth:sentry']);
  });
});

// ── 4. Blocked removals ───────────────────────────────────────────────────────

describe('needsAttention — blocked removals', () => {
  it('flags blocked rows only, with the lock reason', () => {
    const items = needsAttention(
      inputs({
        rows: [
          row('ptah'),
          row('sentry', {
            ref: 'claude-user:sentry',
            origin: 'claude-user',
            removal: {
              kind: 'blocked',
              reason: 'Declared in ~/.claude.json.',
              fixCommand: 'claude mcp remove sentry',
            },
          }),
          row('Gmail', {
            ref: 'claude-connector:Gmail',
            removal: { kind: 'manage-link', reason: 'Managed in claude.ai.' },
          }),
          row('cursor-only', {
            removal: { kind: 'confirm-direct', configPaths: ['x'] },
          }),
        ],
      }),
    );
    expect(items).toEqual([
      {
        id: 'blocked:claude-user:sentry',
        source: 'blocked-removal',
        severity: 'warning',
        title: "sentry can't be removed from Ptah",
        detail: 'Declared in ~/.claude.json.',
        target: { kind: 'server', ref: 'claude-user:sentry' },
      },
    ]);
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────

describe('needsAttention — ordering', () => {
  it('lists errors first, then source order: harness, connections, session, blocked', () => {
    const items = needsAttention(
      inputs({
        rows: [
          oauthRow('sentry', 'expired'),
          row('locked', {
            removal: { kind: 'blocked', reason: 'Locked.' },
          }),
          row('ptah'),
        ],
        harness: {
          summary: summary('error'),
          targets: [
            harnessTarget('claude', { missing: ['a'] }),
            harnessTarget('cursor', {
              writeFailed: [{ relPath: 'b', reason: 'EPERM' }],
            }),
          ],
        },
        smitheryConnections: [connection('c1', 'error')],
        sessionServers: [
          { name: 'ptah', status: 'failed' },
          { name: 'other', status: 'needs-auth' },
        ],
      }),
    );
    expect(items.map((item) => item.id)).toEqual([
      'harness:cursor',
      'smithery:c1',
      'session:ptah',
      'harness:claude',
      'oauth:oauth:sentry',
      'session:other',
      'blocked:harness-config:locked',
    ]);
  });
});
