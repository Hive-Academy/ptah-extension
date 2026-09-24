/**
 * provider-filtering specs, table-driven: each filter alone, filters combined,
 * search terms, every sort key in both directions, stability on ties, and the
 * filter options a control can offer.
 */

import type { McpInstallTarget } from '@ptah-extension/shared';
import {
  applyProviderView,
  filterProviderRows,
  providerFilterOptions,
  providerStatusLabel,
  sortProviderRows,
  type ProviderFilter,
  type ProviderSort,
} from './provider-filtering';
import type {
  ProviderRow,
  ProviderStatus,
  ProviderTarget,
} from './provider-row';
import { statusPresentation } from '../ui/status-pill.component';

const LABELS: Readonly<Record<McpInstallTarget, string>> = {
  vscode: 'VS Code',
  claude: 'Claude Code',
  cursor: 'Cursor',
  copilot: 'Copilot CLI',
  codex: 'Codex CLI',
  antigravity: 'Antigravity CLI',
  opencode: 'OpenCode',
};

function targets(...ids: McpInstallTarget[]): ProviderTarget[] {
  return ids.map((target) => ({
    target,
    label: LABELS[target],
    via: 'configured' as const,
  }));
}

function row(title: string, overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    ref: `${overrides.origin ?? 'harness-config'}:${title}`,
    serverKey: title,
    kind: 'config',
    title,
    brand: null,
    origin: 'harness-config',
    originLabel: 'Config file',
    targets: targets('claude'),
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

/** The brief's connected-servers table, plus one row per status of interest. */
const ROWS: readonly ProviderRow[] = [
  row('ptah', { targets: targets('antigravity', 'claude', 'codex') }),
  row('firecrawl', {
    targets: targets('claude', 'vscode'),
    status: 'connected',
    statusSource: 'session',
  }),
  row('node_repl', { targets: targets('codex') }),
  row('sentry', {
    origin: 'claude-user',
    originLabel: 'Claude CLI',
    targets: [
      { target: 'claude', label: 'Claude Code', via: 'declared-by-cli' },
    ],
    removal: { kind: 'blocked', reason: 'Declared in ~/.claude.json.' },
  }),
  row('sentry', {
    kind: 'connection',
    origin: 'oauth',
    originLabel: 'OAuth',
    targets: [],
    status: 'expired',
    statusSource: 'oauth',
    description: 'Read issues, events and releases from your Sentry projects.',
  }),
  row('exa', {
    kind: 'connection',
    origin: 'smithery',
    originLabel: 'Smithery',
    targets: [],
    status: 'unknown',
    statusSource: 'smithery',
    statusText: 'reconnecting',
  }),
  row('Gmail', {
    kind: 'account-connector',
    origin: 'claude-connector',
    originLabel: 'claude.ai connector',
    targets: [],
    status: 'failed',
    statusSource: 'session',
  }),
];

const refs = (rows: readonly ProviderRow[]): string[] =>
  rows.map((candidate) => candidate.ref);

describe('filterProviderRows', () => {
  it.each<[string, ProviderFilter, string[]]>([
    ['no filter keeps every row in order', {}, refs(ROWS)],
    ['origin', { origin: 'claude-user' }, ['claude-user:sentry']],
    [
      'target (configured)',
      { target: 'codex' },
      ['harness-config:ptah', 'harness-config:node_repl'],
    ],
    [
      'target (declared by the CLI counts)',
      { target: 'claude' },
      ['harness-config:ptah', 'harness-config:firecrawl', 'claude-user:sentry'],
    ],
    ['status', { status: 'expired' }, ['oauth:sentry']],
    [
      'search on the name, case-insensitive',
      { search: 'SENTRY' },
      ['claude-user:sentry', 'oauth:sentry'],
    ],
    ['search on the origin label', { search: 'smithery' }, ['smithery:exa']],
    [
      'search on a target label',
      { search: 'vs code' },
      ['harness-config:firecrawl'],
    ],
    ['search on the description', { search: 'releases' }, ['oauth:sentry']],
    [
      'search on the raw unknown status text',
      { search: 'reconnecting' },
      ['smithery:exa'],
    ],
    ['search on the status label', { search: 'expired' }, ['oauth:sentry']],
    [
      'every search term must match',
      { search: 'sentry oauth' },
      ['oauth:sentry'],
    ],
    ['blank search is no search', { search: '   ' }, refs(ROWS)],
    [
      'filters combine',
      { origin: 'harness-config', target: 'claude', search: 'fire' },
      ['harness-config:firecrawl'],
    ],
    [
      'null filters mean any',
      { origin: null, target: null, status: null, search: '' },
      refs(ROWS),
    ],
    ['no match', { origin: 'oauth', status: 'connected' }, []],
  ])('%s', (_case, filter, expected) => {
    expect(refs(filterProviderRows(ROWS, filter))).toEqual(expected);
  });

  it('does not mutate its input', () => {
    const before = [...ROWS];
    filterProviderRows(ROWS, { origin: 'oauth' });
    expect(ROWS).toEqual(before);
  });
});

describe('sortProviderRows', () => {
  it.each<[string, ProviderSort, string[]]>([
    [
      'name ascending, natural and case-insensitive',
      { key: 'name', direction: 'asc' },
      [
        'smithery:exa',
        'harness-config:firecrawl',
        'claude-connector:Gmail',
        'harness-config:node_repl',
        'harness-config:ptah',
        'claude-user:sentry',
        'oauth:sentry',
      ],
    ],
    [
      'name descending keeps tied names in original order',
      { key: 'name', direction: 'desc' },
      [
        'claude-user:sentry',
        'oauth:sentry',
        'harness-config:ptah',
        'harness-config:node_repl',
        'claude-connector:Gmail',
        'harness-config:firecrawl',
        'smithery:exa',
      ],
    ],
    [
      'origin ascending, ties by name',
      { key: 'origin', direction: 'asc' },
      [
        'harness-config:firecrawl',
        'harness-config:node_repl',
        'harness-config:ptah',
        'claude-user:sentry',
        'smithery:exa',
        'oauth:sentry',
        'claude-connector:Gmail',
      ],
    ],
    [
      'origin descending, ties still by ascending name',
      { key: 'origin', direction: 'desc' },
      [
        'claude-connector:Gmail',
        'oauth:sentry',
        'smithery:exa',
        'claude-user:sentry',
        'harness-config:firecrawl',
        'harness-config:node_repl',
        'harness-config:ptah',
      ],
    ],
    [
      'status ascending puts the urgent first',
      { key: 'status', direction: 'asc' },
      [
        'claude-connector:Gmail',
        'oauth:sentry',
        'smithery:exa',
        'harness-config:firecrawl',
        'harness-config:node_repl',
        'harness-config:ptah',
        'claude-user:sentry',
      ],
    ],
    [
      'status descending puts the quiet first',
      { key: 'status', direction: 'desc' },
      [
        'harness-config:node_repl',
        'harness-config:ptah',
        'claude-user:sentry',
        'harness-config:firecrawl',
        'smithery:exa',
        'oauth:sentry',
        'claude-connector:Gmail',
      ],
    ],
  ])('%s', (_case, sort, expected) => {
    expect(refs(sortProviderRows(ROWS, sort))).toEqual(expected);
  });

  it('is stable for rows equal on every key', () => {
    const twins = [
      row('same', { ref: 'first' }),
      row('same', { ref: 'second' }),
      row('same', { ref: 'third' }),
    ];
    for (const direction of ['asc', 'desc'] as const) {
      expect(
        refs(sortProviderRows(twins, { key: 'status', direction })),
      ).toEqual(['first', 'second', 'third']);
    }
  });

  it('returns a new array', () => {
    const sorted = sortProviderRows(ROWS, { key: 'name', direction: 'asc' });
    expect(sorted).not.toBe(ROWS);
    expect(refs(ROWS)[0]).toBe('harness-config:ptah');
  });
});

describe('applyProviderView', () => {
  it('filters, then sorts', () => {
    expect(
      refs(
        applyProviderView(
          ROWS,
          { target: 'claude' },
          { key: 'name', direction: 'desc' },
        ),
      ),
    ).toEqual([
      'claude-user:sentry',
      'harness-config:ptah',
      'harness-config:firecrawl',
    ]);
  });
});

describe('providerFilterOptions', () => {
  it('offers only present values, counted, in list order', () => {
    expect(providerFilterOptions(ROWS)).toEqual({
      origins: [
        { value: 'harness-config', label: 'Config file', count: 3 },
        { value: 'claude-user', label: 'Claude CLI', count: 1 },
        { value: 'smithery', label: 'Smithery', count: 1 },
        { value: 'oauth', label: 'OAuth', count: 1 },
        { value: 'claude-connector', label: 'claude.ai connector', count: 1 },
      ],
      targets: [
        { value: 'vscode', label: 'VS Code', count: 1 },
        { value: 'claude', label: 'Claude Code', count: 3 },
        { value: 'codex', label: 'Codex CLI', count: 2 },
        { value: 'antigravity', label: 'Antigravity CLI', count: 1 },
      ],
      statuses: [
        { value: 'failed', label: 'Failed', count: 1 },
        { value: 'expired', label: 'Expired', count: 1 },
        { value: 'unknown', label: 'Unknown', count: 1 },
        { value: 'connected', label: 'Connected', count: 1 },
        { value: 'configured', label: 'Configured', count: 3 },
      ],
    });
  });

  it('is empty for no rows', () => {
    expect(providerFilterOptions([])).toEqual({
      origins: [],
      targets: [],
      statuses: [],
    });
  });

  it('labels every status', () => {
    expect(providerStatusLabel('needs-auth')).toBe('Needs sign-in');
    expect(providerStatusLabel('needs-input')).toBe('Needs input');
  });
});

// Batch 10 binding: the filter and search words ARE the pill words.
describe('status words match the status pill', () => {
  const ALL_STATUSES: readonly ProviderStatus[] = [
    'connected',
    'failed',
    'needs-auth',
    'needs-input',
    'pending',
    'disabled',
    'expired',
    'disconnected',
    'configured',
    'unknown',
  ];

  it.each(ALL_STATUSES)('labels %s with the pill word', (status) => {
    expect(providerStatusLabel(status)).toBe(statusPresentation(status).label);
  });

  it.each([
    ['pending', 'Pending'],
    ['needs-input', 'Needs input'],
  ] as const)('labels %s "%s" (the old map said otherwise)', (status, word) => {
    expect(providerStatusLabel(status)).toBe(word);
  });

  it.each(ALL_STATUSES.filter((status) => status !== 'unknown'))(
    'finds a %s row by the word on its pill',
    (status) => {
      const target = row('target-server', { status });
      const other = row('other-server', {
        status: status === 'configured' ? 'connected' : 'configured',
      });
      const word = statusPresentation(status).label;

      expect(
        filterProviderRows([other, target], { search: word }).map(
          (r) => r.title,
        ),
      ).toEqual(['target-server']);
    },
  );

  it('finds an unknown row by its raw pill text, and not by "Unknown"', () => {
    const raw = row('raw-server', { status: 'unknown', statusText: 'warming' });

    expect(filterProviderRows([raw], { search: 'warming' })).toEqual([raw]);
    expect(filterProviderRows([raw], { search: 'unknown' })).toEqual([]);
  });

  it('offers filter options under the pill words', () => {
    const options = providerFilterOptions([
      row('a', { status: 'pending' }),
      row('b', { status: 'needs-input' }),
    ]);

    expect(options.statuses.map((option) => option.label)).toEqual([
      'Needs input',
      'Pending',
    ]);
  });
});
