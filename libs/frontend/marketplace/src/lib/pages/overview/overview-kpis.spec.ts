/**
 * Overview KPI mapper specs (plan C7 `OverviewPage`): each figure from its
 * real source, the harness chip states, and the widget-state rules the page
 * uses for per-source failure isolation.
 */

import type {
  HarnessHealth,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';

import type { ConnectorLink } from '../../data/connector-links.store';
import type { ProviderRow } from '../../data/provider-row';
// The chip presentation has no spec file of its own; its words are pinned here.
import { harnessChipPresentation } from '../../harness/harness-chip-presentation';
import {
  combinedWidgetState,
  connectorsKpi,
  harnessChips,
  harnessKpi,
  harnessStaleError,
  harnessWidgetState,
  serversKpi,
  skillsErrorText,
  skillsKpi,
  widgetStateOf,
} from './overview-kpis';

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    ref: 'harness-config:x',
    serverKey: 'x',
    removal: { kind: 'uninstall' },
    ...overrides,
  } as ProviderRow;
}

function target(
  id: HarnessTargetId,
  overrides: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target: id,
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

function health(targets: HarnessTargetHealth[]): HarnessHealth {
  return { targets } as HarnessHealth;
}

describe('widgetStateOf / combinedWidgetState', () => {
  it.each([
    ['idle', 'loading'],
    ['loading', 'loading'],
    ['ready', 'ready'],
    ['error', 'error'],
  ] as const)('maps %s to %s', (state, expected) => {
    expect(widgetStateOf(state)).toBe(expected);
  });

  it('is an error when any source failed, even while another loads', () => {
    expect(combinedWidgetState(['ready', 'loading', 'error'])).toBe('error');
  });

  it('is loading until every source is ready', () => {
    expect(combinedWidgetState(['ready', 'idle', 'ready'])).toBe('loading');
    expect(combinedWidgetState(['ready', 'ready', 'ready'])).toBe('ready');
  });
});

describe('serversKpi', () => {
  const rows = [
    row(),
    row({ removal: { kind: 'blocked', reason: 'Owned by the Claude CLI' } }),
    row({ removal: { kind: 'blocked', reason: 'Owned by the Claude CLI' } }),
  ];

  it('counts servers and blocked removals, without a live figure when no session reported', () => {
    expect(serversKpi(rows, null)).toEqual({
      value: 3,
      unit: 'servers',
      subLine: '2 blocked',
    });
  });

  it('adds the live figure when a session of the active workspace reported', () => {
    expect(serversKpi(rows, 0).subLine).toBe(
      '2 blocked · 0 live in last session',
    );
  });

  it('uses the singular for one server', () => {
    expect(serversKpi([row()], null).unit).toBe('server');
  });
});

describe('connectorsKpi', () => {
  it('counts connected catalogue entries out of the catalogue size', () => {
    const links = new Map<string, ConnectorLink>([
      ['sentry', { status: 'connected', serverKey: 's' }],
      ['notion', { status: 'needs-auth', serverKey: 'n' }],
      ['linear', { status: 'not-connected' }],
      ['github', { status: 'error', detail: 'x' }],
    ]);

    expect(connectorsKpi(links)).toEqual({
      value: 1,
      unit: 'connected',
      subLine: 'of 4 in the catalogue',
    });
  });
});

describe('skillsKpi', () => {
  it('sums Ptah, community and marketplace, with the breakdown', () => {
    expect(skillsKpi({ ptah: 6, community: 14, marketplace: 3 })).toEqual({
      value: 23,
      unit: 'enabled',
      subLine: '6 Ptah · 14 community · 3 marketplace',
    });
  });

  it('names every failed source in the error text, not only the first', () => {
    expect(
      skillsErrorText([
        { label: 'Community skills', error: 'skills.sh down' },
        { label: 'Marketplace plugins', error: undefined },
      ]),
    ).toBe(
      'Community skills: skills.sh down · Marketplace plugins: Could not load.',
    );
    expect(skillsErrorText([])).toBeNull();
  });
});

describe('harness', () => {
  const report = health([
    target('claude'),
    target('codex', { missing: ['skills/a'] }),
    target('cursor', {
      missing: ['x'],
      writeFailed: [{ relPath: 'x', reason: 'EPERM' }],
    }),
    target('copilot', { detected: false, missing: ['y'] }),
  ]);

  it('builds one chip per detected target, with its sync state', () => {
    expect(harnessChips(report)).toEqual([
      { target: 'claude', label: 'Claude Code', state: 'in-sync' },
      { target: 'codex', label: 'Codex', state: 'out-of-sync' },
      { target: 'cursor', label: 'Cursor', state: 'write-failed' },
    ]);
    expect(harnessChips(null)).toEqual([]);
  });

  it('pairs every chip state with a word, a tone and an icon', () => {
    expect(harnessChipPresentation('in-sync')).toMatchObject({
      label: 'In sync',
      toneClass: 'text-success',
    });
    expect(harnessChipPresentation('out-of-sync')).toMatchObject({
      label: 'Out of sync',
      toneClass: 'text-warning',
    });
    expect(harnessChipPresentation('write-failed')).toMatchObject({
      label: 'Write failed',
      toneClass: 'text-error',
    });
  });

  it('reports detected targets in sync out of detected targets', () => {
    expect(harnessKpi(report)).toEqual({
      value: '1 of 3',
      unit: 'healthy',
      subLine: null,
    });
  });

  it('says so when there is no report or no detected CLI', () => {
    expect(harnessKpi(null)).toEqual({
      value: null,
      unit: null,
      subLine: 'No harness report yet.',
    });
    expect(harnessKpi(health([target('codex', { detected: false })]))).toEqual({
      value: null,
      unit: null,
      subLine: 'No CLI detected in this workspace.',
    });
  });

  it('keeps a report on screen through a re-read, with no stale error', () => {
    expect(harnessWidgetState(report, true, null)).toBe('ready');
    expect(harnessStaleError(report, null)).toBeNull();
  });

  it('keeps the old figures after a failed refresh but surfaces the failure', () => {
    expect(harnessWidgetState(report, false, 'down')).toBe('ready');
    expect(harnessStaleError(report, 'down')).toBe('down');
  });

  it('has no stale error without a report (the error state covers it)', () => {
    expect(harnessStaleError(null, 'down')).toBeNull();
  });

  it('without a report: error on failure, skeleton while reading, ready otherwise', () => {
    expect(harnessWidgetState(null, false, 'down')).toBe('error');
    expect(harnessWidgetState(null, true, null)).toBe('loading');
    expect(harnessWidgetState(null, false, null)).toBe('ready');
  });
});
