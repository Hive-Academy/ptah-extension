/**
 * provider-row specs: status precedence and honesty, removal kinds (with the
 * blocked-only `removalFixCommand` rule), brand resolution through the shared
 * ui resolver, target order, config masking, and the R3 acceptance — a real
 * `mcpDirectory:listInstalled` response carrying env and header secrets run
 * through `MarketplaceInventoryStore` and this mapper, with no secret left in
 * any view-model string.
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
} from '@ptah-extension/core';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import {
  groupInstalledServers,
  type InstalledServerGroup,
} from '@ptah-extension/chat-ui';
import type {
  InstalledMcpServer,
  McpInstallTarget,
  SessionMcpServerEntry,
} from '@ptah-extension/shared';
import { signal } from '@angular/core';
import type {
  ConnectionDates,
  ConnectionDecoration,
} from './connector-links.store';
import { MarketplaceInventoryStore } from './marketplace-inventory.store';
import {
  MASKED_VALUE,
  MCP_TARGET_ORDER,
  toProviderRows,
  type ConfigSummary,
  type ProviderRow,
  type ProviderRowSources,
} from './provider-row';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENV_SECRET = 'env-value-must-not-render';
const HEADER_SECRET = 'header-value-must-not-render';
const ARG_SECRET = 'arg-secret-4242';
const URL_SECRET = 'url-query-secret-777';
const USERINFO_SECRET = 'hunter2-userinfo';
const SECRETS = [
  ENV_SECRET,
  HEADER_SECRET,
  ARG_SECRET,
  URL_SECRET,
  USERINFO_SECRET,
];

function server(overrides: Partial<InstalledMcpServer>): InstalledMcpServer {
  return {
    serverKey: 'firecrawl',
    target: 'claude',
    configPath: 'C:\\repo\\.mcp.json',
    config: { type: 'stdio', command: 'npx', args: ['-y', 'firecrawl-mcp'] },
    managedByPtah: true,
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
    ...overrides,
  };
}

function groupOf(...servers: InstalledMcpServer[]): InstalledServerGroup {
  const [group] = groupInstalledServers(servers);
  return group;
}

interface SourceOptions {
  session?: readonly SessionMcpServerEntry[];
  decoration?: ConnectionDecoration | null;
  dates?: ConnectionDates;
}

function sources(options: SourceOptions = {}): ProviderRowSources {
  return {
    sessionServers: options.session ?? [],
    statusFor: () => options.decoration ?? null,
    datesFor: () => options.dates ?? {},
  };
}

function rowOf(
  group: InstalledServerGroup,
  options: SourceOptions = {},
): ProviderRow {
  const [row] = toProviderRows([group], sources(options));
  return row;
}

const configRow = (target: McpInstallTarget = 'claude') =>
  groupOf(server({ target }));
const oauthGroup = () =>
  groupOf(
    server({
      serverKey: 'sentry',
      target: undefined,
      configPath: '',
      config: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
      origin: 'oauth',
      originLabel: 'OAuth',
      removal: 'oauth',
    }),
  );
const smitheryGroup = () =>
  groupOf(
    server({
      serverKey: 'exa',
      target: undefined,
      configPath: '',
      config: { type: 'http', url: '' },
      origin: 'smithery',
      originLabel: 'Smithery',
      removal: 'smithery',
    }),
  );
const claudeUserGroup = (fixCommand?: string) =>
  groupOf(
    server({
      serverKey: 'sonarqube',
      target: undefined,
      configPath: 'C:\\Users\\me\\.claude.json',
      managedByPtah: false,
      origin: 'claude-user',
      originLabel: 'Claude CLI',
      removal: 'none',
      removalBlockedReason: 'Declared in ~/.claude.json, owned by Claude CLI.',
      ...(fixCommand === undefined ? {} : { removalFixCommand: fixCommand }),
    }),
  );
const connectorGroup = () =>
  groupOf(
    server({
      serverKey: 'Gmail',
      target: undefined,
      configPath: '',
      config: { type: 'http', url: '' },
      managedByPtah: false,
      origin: 'claude-connector',
      originLabel: 'claude.ai connector',
      removal: 'none',
      removalBlockedReason: 'Manage this connector in your claude.ai settings.',
    }),
  );

/** Every string reachable from a value, keys included. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      stringsIn(item, out);
    }
  }
  return out;
}

// ── Status ────────────────────────────────────────────────────────────────────

describe('toProviderRows — status', () => {
  const session = (status: string): SessionMcpServerEntry[] => [
    { name: 'sentry', status },
  ];

  it.each([
    // [case, group, options, status, source]
    [
      'session wins over a live OAuth state',
      oauthGroup,
      {
        session: session('needs-auth'),
        decoration: { source: 'oauth', state: 'connected' },
      },
      'needs-auth',
      'session',
    ],
    [
      'OAuth state when no session reported the key',
      oauthGroup,
      { decoration: { source: 'oauth', state: 'expired' } },
      'expired',
      'oauth',
    ],
    [
      'Smithery status mapped to the row vocabulary',
      smitheryGroup,
      { decoration: { source: 'smithery', status: 'auth_required' } },
      'needs-auth',
      'smithery',
    ],
    [
      'Smithery input_required',
      smitheryGroup,
      { decoration: { source: 'smithery', status: 'input_required' } },
      'needs-input',
      'smithery',
    ],
    [
      'Smithery error',
      smitheryGroup,
      { decoration: { source: 'smithery', status: 'error' } },
      'failed',
      'smithery',
    ],
    ['configured with no live source', oauthGroup, {}, 'configured', 'config'],
  ] as const)('%s', (_case, group, options, status, source) => {
    const row = rowOf(group(), options as SourceOptions);
    expect(row.status).toBe(status);
    expect(row.statusSource).toBe(source);
    expect(row.statusText).toBeUndefined();
  });

  it.each(['connected', 'failed', 'needs-auth', 'pending', 'disabled'])(
    'maps the session status "%s" as-is',
    (status) => {
      const row = rowOf(configRow(), {
        session: [{ name: 'firecrawl', status }],
      });
      expect(row).toMatchObject({ status, statusSource: 'session' });
    },
  );

  it('matches session entries through the normalized key', () => {
    const row = rowOf(configRow(), {
      session: [{ name: 'FireCrawl', status: 'connected' }],
    });
    expect(row.status).toBe('connected');
  });

  it('never borrows a session status for a row no Ptah session loads', () => {
    // A VS Code-only config entry: the Claude session's same-named server is
    // a different configuration, so the row stays `configured`.
    const row = rowOf(configRow('vscode'), {
      session: [{ name: 'firecrawl', status: 'connected' }],
    });
    expect(row).toMatchObject({ status: 'configured', statusSource: 'config' });
  });

  it('never answers connected for a config row without a live source', () => {
    for (const group of [configRow(), claudeUserGroup(), configRow('codex')]) {
      expect(rowOf(group).status).toBe('configured');
    }
  });

  it('maps an unrecognised session status to unknown with the raw text', () => {
    const row = rowOf(configRow(), {
      session: [{ name: 'firecrawl', status: 'reconnecting' }],
    });
    expect(row).toMatchObject({
      status: 'unknown',
      statusSource: 'session',
      statusText: 'reconnecting',
    });
  });

  it('maps a Smithery unknown to unknown with the raw text', () => {
    const row = rowOf(smitheryGroup(), {
      decoration: { source: 'smithery', status: 'unknown' },
    });
    expect(row).toMatchObject({
      status: 'unknown',
      statusSource: 'smithery',
      statusText: 'unknown',
    });
  });

  it('keeps the live connection beside a session-derived status', () => {
    const decoration: ConnectionDecoration = {
      source: 'oauth',
      state: 'expired',
    };
    const row = rowOf(oauthGroup(), {
      session: session('connected'),
      decoration,
    });
    expect(row.status).toBe('connected');
    expect(row.connection).toEqual(decoration);
  });
});

// ── Session ownership across origins ─────────────────────────────────────────

describe('toProviderRows — one session report, at most one row', () => {
  /** A same-named `sentry` row of each origin that can collide. */
  const project = (target: McpInstallTarget = 'claude') =>
    groupOf(server({ serverKey: 'sentry', target }));
  const claudeUser = () =>
    groupOf(
      server({
        serverKey: 'sentry',
        target: undefined,
        configPath: 'C:\\Users\\me\\.claude.json',
        managedByPtah: false,
        origin: 'claude-user',
        originLabel: 'Claude CLI',
        removal: 'none',
      }),
    );
  const smithery = () =>
    groupOf(
      server({
        serverKey: 'sentry',
        target: undefined,
        configPath: '',
        config: { type: 'http', url: '' },
        origin: 'smithery',
        originLabel: 'Smithery',
        removal: 'smithery',
      }),
    );
  const connected: SessionMcpServerEntry[] = [
    { name: 'sentry', status: 'connected' },
  ];

  /** `status/statusSource` per row ref, so order cannot hide a mismatch. */
  function statusByRef(
    groups: readonly InstalledServerGroup[],
    options: SourceOptions | ProviderRowSources,
  ): Record<string, string> {
    const rowSources = 'sessionServers' in options ? options : sources(options);
    return Object.fromEntries(
      toProviderRows(groups, rowSources).map((row) => [
        row.ref,
        `${row.status}/${row.statusSource}`,
      ]),
    );
  }

  it('gives the report to neither a ~/.claude.json row nor a .mcp.json row of the same name', () => {
    // `~/.claude.json` may hold the entry at local scope (beats project) or
    // user scope (loses to project); the wire does not say which.
    expect(
      statusByRef([project(), claudeUser()], { session: connected }),
    ).toEqual({
      'harness-config:sentry': 'configured/config',
      'claude-user:sentry': 'configured/config',
    });
  });

  it('gives the report to the ~/.claude.json row when the same-named config row is one no session loads', () => {
    expect(
      statusByRef([project('vscode'), claudeUser()], { session: connected }),
    ).toEqual({
      'harness-config:sentry': 'configured/config',
      'claude-user:sentry': 'connected/session',
    });
  });

  it('gives the report to the SDK-injected connection over every config-file row, in any order', () => {
    const groups = [project(), claudeUser(), oauthGroup()];
    const expected = {
      'harness-config:sentry': 'configured/config',
      'claude-user:sentry': 'configured/config',
      'oauth:sentry': 'connected/session',
    };
    expect(statusByRef(groups, { session: connected })).toEqual(expected);
    expect(statusByRef([...groups].reverse(), { session: connected })).toEqual(
      expected,
    );
  });

  it('leaves two rows of one scope on their own live status', () => {
    // OAuth and Smithery both reach the session through `mcpServers`; the
    // report cannot say which one it describes.
    const rowSources: ProviderRowSources = {
      sessionServers: connected,
      statusFor: (ref) =>
        ref.origin === 'oauth'
          ? { source: 'oauth', state: 'expired' }
          : { source: 'smithery', status: 'auth_required' },
      datesFor: () => ({}),
    };
    expect(statusByRef([oauthGroup(), smithery()], rowSources)).toEqual({
      'oauth:sentry': 'expired/oauth',
      'smithery:sentry': 'needs-auth/smithery',
    });
  });
});

// ── Removal ───────────────────────────────────────────────────────────────────

describe('toProviderRows — removal', () => {
  it.each([
    ['ptah-managed', configRow(), { kind: 'uninstall' }],
    [
      'direct',
      groupOf(
        server({
          managedByPtah: false,
          removal: 'direct',
          configPath: 'C:\\Users\\me\\.cursor\\mcp.json',
          target: 'cursor',
        }),
      ),
      {
        kind: 'confirm-direct',
        configPaths: ['C:\\Users\\me\\.cursor\\mcp.json'],
      },
    ],
    ['oauth', oauthGroup(), { kind: 'disconnect' }],
    ['smithery', smitheryGroup(), { kind: 'disconnect' }],
    [
      'claude-user without a command',
      claudeUserGroup(),
      {
        kind: 'blocked',
        reason: 'Declared in ~/.claude.json, owned by Claude CLI.',
      },
    ],
    [
      'claude-user with a command',
      claudeUserGroup('claude mcp remove sonarqube -s user'),
      {
        kind: 'blocked',
        reason: 'Declared in ~/.claude.json, owned by Claude CLI.',
        fixCommand: 'claude mcp remove sonarqube -s user',
      },
    ],
    [
      'claude.ai connector',
      connectorGroup(),
      {
        kind: 'manage-link',
        reason: 'Manage this connector in your claude.ai settings.',
      },
    ],
  ] as const)('%s', (_case, group, removal) => {
    expect(rowOf(group).removal).toEqual(removal);
  });

  it('ignores removalFixCommand on every removable row', () => {
    // The wire type does not tie the command to blocked rows.
    for (const removal of ['ptah-managed', 'direct', 'oauth', 'smithery']) {
      const row = rowOf(
        groupOf(
          server({
            removal: removal as InstalledMcpServer['removal'],
            removalFixCommand: 'rm -rf ~',
          }),
        ),
      );
      expect(stringsIn(row)).not.toContain('rm -rf ~');
      expect(row.removal).not.toHaveProperty('fixCommand');
    }
  });

  it('falls back to a fixed reason when a blocked row carries none', () => {
    const row = rowOf(
      groupOf(server({ origin: 'claude-user', removal: 'none' })),
    );
    expect(row.removal).toEqual({
      kind: 'blocked',
      reason: 'Ptah cannot remove this server from here.',
    });
  });
});

// ── Identity, brand, targets, description, dates ──────────────────────────────

describe('toProviderRows — identity and presentation', () => {
  it('uses the server ref as the row ref and the key as the title', () => {
    const row = rowOf(claudeUserGroup());
    expect(row).toMatchObject({
      ref: 'claude-user:sonarqube',
      serverKey: 'sonarqube',
      title: 'sonarqube',
      origin: 'claude-user',
      originLabel: 'Claude CLI',
      kind: 'config',
    });
  });

  it.each([
    ['harness-config', configRow(), 'config'],
    ['claude-user', claudeUserGroup(), 'config'],
    ['oauth', oauthGroup(), 'connection'],
    ['smithery', smitheryGroup(), 'connection'],
    ['claude-connector', connectorGroup(), 'account-connector'],
  ] as const)('kind of a %s row', (_origin, group, kind) => {
    expect(rowOf(group).kind).toBe(kind);
  });

  it.each([
    ['sentry', undefined, 'sentry'],
    ['shopify-dev-mcp', undefined, 'shopify'],
    ['chrome-devtools', undefined, 'google-chrome'],
    ['sequential-thinking', undefined, null],
    ['my-errors', 'https://mcp.sentry.dev/mcp', 'sentry'],
  ] as const)('brand of %s (url %s) is %s', (serverKey, url, brand) => {
    const config =
      url === undefined
        ? ({ type: 'stdio', command: 'npx' } as const)
        : ({ type: 'http', url } as const);
    expect(rowOf(groupOf(server({ serverKey, config }))).brand).toBe(brand);
  });

  it('lists configured targets in TARGET_LABELS order', () => {
    const group = groupOf(
      server({ target: 'codex' }),
      server({ target: 'claude' }),
      server({ target: 'antigravity' }),
    );
    expect(rowOf(group).targets).toEqual([
      { target: 'claude', label: 'Claude Code', via: 'configured' },
      { target: 'codex', label: 'Codex CLI', via: 'configured' },
      { target: 'antigravity', label: 'Antigravity CLI', via: 'configured' },
    ]);
    expect(MCP_TARGET_ORDER).toEqual([
      'vscode',
      'claude',
      'cursor',
      'copilot',
      'codex',
      'antigravity',
      'opencode',
    ]);
  });

  it('marks a claude-user row as declared by the Claude CLI', () => {
    expect(rowOf(claudeUserGroup()).targets).toEqual([
      { target: 'claude', label: 'Claude Code', via: 'declared-by-cli' },
    ]);
  });

  it('gives connections and connectors no targets', () => {
    expect(rowOf(oauthGroup()).targets).toEqual([]);
    expect(rowOf(connectorGroup()).targets).toEqual([]);
  });

  it('shows a description only on a catalogue match', () => {
    expect(rowOf(oauthGroup()).description).toBe(
      'Read issues, events and releases from your Sentry projects.',
    );
    expect(rowOf(configRow())).not.toHaveProperty('description');
  });

  it('carries connection dates for connection rows only', () => {
    const dates = { connectedAt: '2026-09-01T10:00:00.000Z' };
    expect(rowOf(oauthGroup(), { dates }).dates).toEqual(dates);
    expect(rowOf(configRow(), { dates })).not.toHaveProperty('dates');
    expect(rowOf(smitheryGroup(), { dates: {} })).not.toHaveProperty('dates');
  });

  it('copies the config paths', () => {
    expect(rowOf(configRow()).configPaths).toEqual(['C:\\repo\\.mcp.json']);
  });
});

// ── Masking ───────────────────────────────────────────────────────────────────

describe('toProviderRows — config masking', () => {
  it('summarises a stdio config with env KEYS and masked secret arguments', () => {
    const row = rowOf(
      groupOf(
        server({
          config: {
            type: 'stdio',
            command: 'npx',
            args: [
              '-y',
              'some-mcp',
              '--api-key',
              ARG_SECRET,
              `--token=${ARG_SECRET}`,
              `Authorization: Bearer ${ARG_SECRET}`,
              `https://user:${USERINFO_SECRET}@host.example/mcp?key=${URL_SECRET}`,
              '--port',
              '3000',
            ],
            env: { ZETA_KEY: ENV_SECRET, API_KEY: ENV_SECRET },
          },
        }),
      ),
    );
    expect(row.configSummary).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: [
        '-y',
        'some-mcp',
        '--api-key',
        MASKED_VALUE,
        `--token=${MASKED_VALUE}`,
        `Authorization: ${MASKED_VALUE}`,
        `https://host.example/mcp?key=${MASKED_VALUE}`,
        '--port',
        '3000',
      ],
      envKeys: ['API_KEY', 'ZETA_KEY'],
    });
  });

  it('summarises a remote config with a masked URL and header KEYS', () => {
    const row = rowOf(
      groupOf(
        server({
          config: {
            type: 'sse',
            url: `https://me:${USERINFO_SECRET}@mcp.example.com/sse?token=${URL_SECRET}&v=2#frag`,
            headers: { Authorization: `Bearer ${HEADER_SECRET}` },
          },
        }),
      ),
    );
    expect(row.configSummary).toEqual({
      transport: 'sse',
      url: `https://mcp.example.com/sse?token=${MASKED_VALUE}&v=${MASKED_VALUE}`,
      envKeys: [],
      headerKeys: ['Authorization'],
    });
  });

  /** A stdio row's masked args. */
  const maskedArgs = (args: string[]): readonly string[] => {
    const summary = rowOf(
      groupOf(server({ config: { type: 'stdio', command: 'npx', args } })),
    ).configSummary;
    return summary.transport === 'stdio' ? summary.args : [];
  };

  // Assembled at runtime so no contiguous token sits in the source.
  const tail = (length: number) => 'A1b2C3d4'.repeat(8).slice(0, length);
  const SHAPED_SECRETS: readonly (readonly [string, string])[] = [
    ['OpenAI / Anthropic', 'sk-' + 'live-' + tail(20)],
    ['Anthropic', 'sk-ant-' + 'api03-' + tail(24)],
    ['Stripe secret', 'sk_' + 'live_' + tail(16)],
    ['Stripe restricted', 'rk_' + 'test_' + tail(16)],
    ['GitHub classic', 'gh' + 'p_' + tail(36)],
    ['GitHub OAuth', 'gh' + 'o_' + tail(36)],
    ['GitHub fine-grained', 'github_' + 'pat_' + tail(40)],
    ['GitLab', 'gl' + 'pat-' + tail(20)],
    ['Slack bot', 'xo' + 'xb-' + tail(24)],
    ['Slack user', 'xo' + 'xp-' + tail(24)],
    ['AWS key id', 'AK' + 'IA' + 'IOSFODNN7EXAMPLE'],
    ['Google API key', 'AI' + 'za' + tail(35)],
    ['JWT', 'ey' + 'J' + tail(12) + '.ey' + 'J' + tail(12) + '.' + tail(10)],
    ['long mixed-case token', tail(40)],
    ['long hex token', '0123456789abcdef'.repeat(4)],
  ];

  it.each(SHAPED_SECRETS)(
    'masks a bare %s value after a neutral flag',
    (_case, secret) => {
      expect(maskedArgs(['--config', secret, secret])).toEqual([
        '--config',
        MASKED_VALUE,
        MASKED_VALUE,
      ]);
    },
  );

  it('masks a secret-shaped value in a neutral assignment', () => {
    const secret = 'sk-' + 'proj-' + tail(24);
    expect(maskedArgs([`--config=${secret}`, `MODE: ${secret}`])).toEqual([
      `--config=${MASKED_VALUE}`,
      `MODE: ${MASKED_VALUE}`,
    ]);
  });

  it('keeps every ordinary argument as written', () => {
    const ordinary = [
      '-y',
      '--yes',
      '@modelcontextprotocol/server-filesystem',
      '@upstash/context7-mcp@latest',
      'firecrawl-mcp',
      'mcp-server-sequential-thinking-extended-edition',
      'skill-creator',
      'sk-mcp',
      'C:\\Users\\me\\projects\\ptah-extension',
      '/usr/local/lib/node_modules/some-mcp/dist/index.js',
      './relative/path/to/config.json',
      '--port',
      '3000',
      'NODE_OPTIONS=--max-old-space-size=4096',
      'LOG_LEVEL=debug',
      '123e4567-e89b-12d3-a456-426614174000',
      'AKIA-not-a-key',
      'github_pat_',
      'SOME_VERY_LONG_ENVIRONMENT_VARIABLE_NAME_2',
    ];
    expect(maskedArgs(ordinary)).toEqual(ordinary);
  });

  it('keeps a short free-form secret after a neutral flag (documented limit)', () => {
    expect(maskedArgs(['--config', 'hunter2'])).toEqual([
      '--config',
      'hunter2',
    ]);
  });

  it('reports no URL for a connector row', () => {
    expect(rowOf(connectorGroup()).configSummary).toEqual({
      transport: 'http',
      url: null,
      envKeys: [],
      headerKeys: [],
    });
  });

  it('has no field that can hold an env or header value (type level)', () => {
    const withEnv: ConfigSummary = {
      transport: 'stdio',
      command: 'npx',
      args: [],
      envKeys: ['API_KEY'],
      // @ts-expect-error ConfigSummary carries env KEYS only, never values.
      env: { API_KEY: ENV_SECRET },
    };
    const withHeaders: ConfigSummary = {
      transport: 'http',
      url: null,
      envKeys: [],
      headerKeys: ['Authorization'],
      // @ts-expect-error ConfigSummary carries header KEYS only, never values.
      headers: { Authorization: HEADER_SECRET },
    };
    // The runtime half of the guarantee lives in the mapper specs above.
    expect(withEnv.transport).toBe('stdio');
    expect(withHeaders.transport).toBe('http');
  });
});

// ── R3 acceptance: store → mapper → view model ────────────────────────────────

describe('R3 acceptance — listInstalled secrets never reach the view model', () => {
  /** A `mcpDirectory:listInstalled` payload shaped like the backend's. */
  const LIST_INSTALLED_RESPONSE: { servers: InstalledMcpServer[] } = {
    servers: [
      server({
        serverKey: 'firecrawl',
        target: 'claude',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'firecrawl-mcp', '--api-key', ARG_SECRET],
          env: { FIRECRAWL_API_KEY: ENV_SECRET },
        },
      }),
      server({
        serverKey: 'firecrawl',
        target: 'vscode',
        configPath: 'C:\\repo\\.vscode\\mcp.json',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'firecrawl-mcp'],
          env: { FIRECRAWL_API_KEY: ENV_SECRET },
        },
      }),
      server({
        serverKey: 'github',
        target: 'cursor',
        configPath: 'C:\\Users\\me\\.cursor\\mcp.json',
        managedByPtah: false,
        removal: 'direct',
        config: {
          type: 'http',
          url: `https://x:${USERINFO_SECRET}@api.githubcopilot.com/mcp/?t=${URL_SECRET}`,
          headers: { Authorization: `Bearer ${HEADER_SECRET}` },
          env: { GITHUB_TOKEN: ENV_SECRET },
        },
      }),
      server({
        serverKey: 'sentry',
        target: undefined,
        configPath: 'C:\\Users\\me\\.claude.json',
        managedByPtah: false,
        origin: 'claude-user',
        originLabel: 'Claude CLI',
        removal: 'none',
        removalBlockedReason:
          'Declared in ~/.claude.json, owned by Claude CLI.',
        removalFixCommand: 'claude mcp remove sentry -s user',
        config: {
          type: 'http',
          url: 'https://mcp.sentry.dev/mcp',
          headers: { 'X-Api-Key': HEADER_SECRET },
        },
      }),
    ],
  };

  afterEach(() => TestBed.resetTestingModule());

  it('masks every env, header, argument and URL secret end to end', async () => {
    const rpc = {
      call: jest.fn((method: string) =>
        Promise.resolve(
          method === 'mcpDirectory:listInstalled'
            ? {
                success: true,
                data: LIST_INSTALLED_RESPONSE,
                error: undefined,
                isSuccess: () => true,
              }
            : {
                success: false,
                data: undefined,
                error: `No responder for ${method}`,
                isSuccess: () => false,
              },
        ),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MarketplaceInventoryStore,
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded: () => Promise.resolve(),
            refresh: () => Promise.resolve(),
            enabledPlugins: signal([]).asReadonly(),
            error: signal<string | null>(null).asReadonly(),
          },
        },
      ],
    });
    TestBed.inject(SessionMcpStatusRegistry).record('session-1', {
      servers: [
        { name: 'firecrawl', status: 'connected' },
        { name: 'Gmail', status: 'connected' },
      ],
      notices: [],
    });
    const store = TestBed.inject(MarketplaceInventoryStore);

    await store.ensure('installed');
    const slice = store.installed();
    expect(slice.state).toBe('ready');
    // The store still hands raw config out (R3): the mapper is the mask.
    expect(JSON.stringify(slice.data)).toContain(ENV_SECRET);

    const rows = toProviderRows(slice.data, {
      sessionServers: store.newestSessionStatus()?.servers ?? [],
      statusFor: () => null,
      datesFor: () => ({}),
    });

    expect(rows.map((row) => row.ref)).toEqual([
      'harness-config:firecrawl',
      'harness-config:github',
      'claude-user:sentry',
      'claude-connector:Gmail',
    ]);
    const strings = stringsIn(rows);
    for (const secret of SECRETS) {
      expect(strings.filter((text) => text.includes(secret))).toEqual([]);
    }
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(SECRETS.join('|')));
    // Keys survive the mask; the blocked row keeps its copyable command.
    expect(rows[0].configSummary.envKeys).toEqual(['FIRECRAWL_API_KEY']);
    expect(rows[1].configSummary).toMatchObject({
      headerKeys: ['Authorization'],
      envKeys: ['GITHUB_TOKEN'],
    });
    expect(rows[2].removal).toEqual({
      kind: 'blocked',
      reason: 'Declared in ~/.claude.json, owned by Claude CLI.',
      fixCommand: 'claude mcp remove sentry -s user',
    });
    expect(rows[0].status).toBe('connected');
    expect(rows[3]).toMatchObject({
      kind: 'account-connector',
      status: 'connected',
      removal: { kind: 'manage-link' },
    });
  });
});
