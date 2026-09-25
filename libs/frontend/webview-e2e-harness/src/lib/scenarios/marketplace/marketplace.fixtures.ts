/**
 * Shared fixtures for the Marketplace e2e scenarios (TASK_2026_533 Batch 25,
 * Task 25.1/25.2).
 *
 * Data reproduces `prototype-brief.md:42-69` ("Real data to use — do not
 * invent other shapes"): the eleven disk-installed MCP servers (with `sentry`
 * and `sonarqube` blocked, matching the real screen the brief was written
 * from), the Ptah plugin catalogue (6/9 enabled), 14 installed community
 * (skills.sh) skills, and 3 installed external-marketplace plugins.
 *
 * Pattern followed: `../thoth/skills-lane-pickers.e2e.spec.ts`'s
 * `installRpcAutoResponder` (the `rpc:response` auto-responder over the
 * postMessage bridge) and `../vscode-shell/vscode-host.ts`'s host-config
 * injector. Centralised here (rather than duplicated per spec file, which is
 * the thoth file's own pattern) because THREE marketplace spec files need the
 * identical responder and host shapes; duplicating a working responder three
 * times would be the harness's "invented technique" antipattern, not reuse.
 * Unlike the thoth responder, dynamic answers are Node-side functions reached
 * through `page.exposeFunction`, so no fixture source is ever evaluated in the
 * page.
 */
import { expect, type Locator, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Host config injectors
// ---------------------------------------------------------------------------

/**
 * Exact shape `apps/ptah-electron/src/preload.ts` injects (see the thoth
 * spec's "HOST CONFIG NOTE" for why this is the honest way to drive the
 * Electron branch through this harness). `initialView` decides which surface
 * `App.handleInitialView()` navigates to on boot.
 */
export function electronHostConfig(
  initialView: string,
): Record<string, unknown> {
  return {
    isVSCode: false,
    isElectron: true,
    theme: 'dark',
    workspaceRoot: 'C:\\ptah-e2e-ws-a',
    workspaceName: 'ptah-e2e-ws-a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: 'e2e-harness',
    platform: 'win32',
    initialView,
  };
}

/**
 * Exact shape a real VS Code webview host injects (`installVSCodeHost` in
 * `../vscode-shell/vscode-host.ts`, reproduced here with a settable
 * `initialView` because that helper hardcodes `'chat'`).
 */
export function vscodeHostConfig(initialView: string): Record<string, unknown> {
  return {
    isVSCode: true,
    theme: 'dark',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: 'e2e-harness',
    platform: 'win32',
    initialView,
  };
}

export async function installHost(
  page: Page,
  host: 'electron' | 'vscode',
  initialView: string,
): Promise<void> {
  const config =
    host === 'electron'
      ? electronHostConfig(initialView)
      : vscodeHostConfig(initialView);
  await page.addInitScript((cfg: Record<string, unknown>) => {
    (window as unknown as { ptahConfig?: unknown }).ptahConfig = cfg;
  }, config);
}

// ---------------------------------------------------------------------------
// RPC auto-responder — the `rpc:response` mechanism of
// `../thoth/skills-lane-pickers.e2e.spec.ts`'s `installRpcAutoResponder`,
// with dynamic answers resolved on the Node side.
// ---------------------------------------------------------------------------

/**
 * A params-aware fixture: runs in the Playwright (Node) process, never in the
 * page. Its argument and return value cross the page boundary as serialisable
 * data.
 */
export type RpcFixtureResolver = (params: unknown) => unknown;

/** Page binding the in-page responder calls to reach a {@link RpcFixtureResolver}. */
const RESOLVE_BINDING = '__ptahMarketplaceResolveRpc';

/**
 * Wire an in-page RPC auto-responder over the postMessage bridge. MUST be
 * called after `installPostMessageBridge` (so `acquireVsCodeApi` exists) and
 * before `page.goto(...)`, and at most once per page (the resolver binding
 * can be exposed only once).
 *
 * A fixture value that is a function is a {@link RpcFixtureResolver}: the
 * in-page responder sends the call's method and params to it through a
 * `page.exposeFunction` binding and answers with what it returns. Every other
 * value is static data, serialised into the page once. This is how the
 * workspace-switch scenario (`marketplace-servers.e2e.spec.ts`) changes
 * `mcpDirectory:listInstalled`'s answer between calls without a second
 * `addInitScript` trip: the resolver closes over its own call counter.
 */
export async function installRpcAutoResponder(
  page: Page,
  fixtures: Record<string, unknown>,
): Promise<void> {
  const staticAnswers: Record<string, unknown> = {};
  const resolvers = new Map<string, RpcFixtureResolver>();
  for (const [method, value] of Object.entries(fixtures)) {
    if (typeof value === 'function') {
      resolvers.set(method, value as RpcFixtureResolver);
    } else {
      staticAnswers[method] = value;
    }
  }
  if (resolvers.size > 0) {
    await page.exposeFunction(
      RESOLVE_BINDING,
      (method: string, params: unknown): unknown => {
        const resolver = resolvers.get(method);
        if (resolver === undefined) {
          throw new Error(`No RPC fixture resolver for "${method}"`);
        }
        return resolver(params);
      },
    );
  }
  const setup = {
    staticAnswers,
    resolvedMethods: [...resolvers.keys()],
    binding: RESOLVE_BINDING,
  };
  await page.addInitScript((serializedSetup: string) => {
    const {
      staticAnswers: parsedFixtures,
      resolvedMethods,
      binding,
    } = JSON.parse(serializedSetup) as {
      staticAnswers: Record<string, unknown>;
      resolvedMethods: string[];
      binding: string;
    };
    const w = window as unknown as {
      acquireVsCodeApi?: () => {
        postMessage: (msg: unknown) => void;
        getState: () => unknown;
        setState: () => unknown;
      };
      vscode?: unknown;
    } & Record<string, unknown>;
    const respond = (
      correlationId: string | undefined,
      data: unknown,
    ): void => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'rpc:response', correlationId, success: true, data },
        }),
      );
    };
    if (typeof w.acquireVsCodeApi !== 'function') {
      return;
    }
    const api = w.acquireVsCodeApi();
    const originalPostMessage = api.postMessage.bind(api);
    api.postMessage = (msg: unknown): void => {
      originalPostMessage(msg);
      const envelope = msg as {
        type?: string;
        payload?: {
          method?: string;
          params?: unknown;
          correlationId?: string;
        };
      };
      if (envelope?.type !== 'rpc:call' || !envelope.payload?.method) {
        return;
      }
      const { method, params, correlationId } = envelope.payload;
      if (resolvedMethods.includes(method)) {
        const resolve = w[binding] as (
          m: string,
          p: unknown,
        ) => Promise<unknown>;
        // A resolver failure leaves the call unanswered, the same outcome as
        // an unfixtured method; the error is logged so the spec's own
        // timeout is traceable to it.
        resolve(method, params).then(
          (data) => respond(correlationId, data),
          (error: unknown) =>
            console.error(`RPC fixture resolver for ${method} failed`, error),
        );
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(parsedFixtures, method)) {
        return;
      }
      const data = parsedFixtures[method];
      queueMicrotask(() => respond(correlationId, data));
    };
    w.vscode = api;
  }, JSON.stringify(setup));
}

// ---------------------------------------------------------------------------
// Registry `CatalogCard` vendor-mark wait — shared, Revise round 2 item A1.
// ---------------------------------------------------------------------------

/**
 * Waits for ONE registry `CatalogCard`'s vendor mark to leave its
 * `@defer (on immediate)` placeholder and resolve — either to the real
 * brand mark (an allowlisted vendor) or to that card's own, non-deferred
 * monogram tile (everything else). The two placeholder/resolved shapes are
 * structurally different, not just visually
 * (`mcp-directory-browser.component.ts:166-182`):
 *
 * - Allowlisted card: `<span card-mark>` wraps the `@defer` block. Its
 *   `@placeholder`/`@error` branches render a BARE `<ptah-monogram-tile>`
 *   (no `card-mark` attribute of its own — the attribute lives on the
 *   wrapping `<span>`); the resolved branch renders `<ptah-brand-mark>` in
 *   its place.
 * - Everything else: `<ptah-monogram-tile card-mark>` is rendered directly,
 *   with no `@defer` block at all — it carries `card-mark` from the first
 *   paint and is never a placeholder.
 *
 * So `[card-mark] ptah-brand-mark, ptah-monogram-tile[card-mark]` matches
 * ONLY a resolved state for either kind of card, and never the transient
 * bare-monogram placeholder — the same condition the registry vendor-mark
 * functional test already waits on
 * (`marketplace-servers.e2e.spec.ts`, "shows the Sentry vendor mark...").
 * Centralised here (rather than duplicated in that spec and in
 * `marketplace-visual.e2e.spec.ts`'s registry screenshot capture, which had
 * no wait for this at all — code-logic-review round-1 Moderate finding) so
 * both wait on the exact same real condition.
 */
export async function waitForCatalogCardMarkResolved(
  card: Locator,
  timeout = 10_000,
): Promise<void> {
  await expect(
    card.locator('[card-mark] ptah-brand-mark, ptah-monogram-tile[card-mark]'),
  ).toBeVisible({ timeout });
}

// ---------------------------------------------------------------------------
// Animated-surface settle wait — shared, Revise round 2 item B1.
// ---------------------------------------------------------------------------

/**
 * Waits for every currently-playing (or about-to-play) CSS animation/
 * transition inside `target` to reach its `finished` state.
 *
 * Batch 25b found BOTH round-1 "blocking visual" findings were captures
 * fired mid entry-animation, not product defects: the server-detail
 * drawer's 180ms slide-in (`native-drawer.component.ts:134-158`,
 * `@keyframes ptah-drawer-slide-in-right`) and the dashboard skill-picker
 * dialog's ~200ms daisyUI modal fade (a CSS `transition`, not a keyframe
 * animation — `getAnimations()` reports both kinds identically as
 * `Animation` objects, so one helper covers both). Round 1's own
 * `waitForSettled()` has no opinion on animation state at all — it only
 * checks for RPC-driven skeletons/spinners — so it silently let a capture
 * fire while `transform`/`opacity` were still mid-flight.
 *
 * First waits (up to `timeout`, polled via `requestAnimationFrame`) for
 * `target.getAnimations({ subtree: true })` to report at least one
 * animation, so a call landing on the exact frame BEFORE the browser has
 * started the animation cannot read an empty list and be mistaken for
 * "already settled" — the specific silent-pass failure mode this exists to
 * close. If nothing ever starts animating, `target` legitimately has
 * nothing to wait for and this returns without further delay. Once any
 * animation is found, awaits every one of THAT target's animations
 * (backdrop fade + panel slide together, when `target` is the whole shell)
 * via its real `.finished` promise — the same mechanism the task named
 * (`element.getAnimations()... finished`) — so a capture downstream of this
 * call is provably past its entrance transition, not just probably past it.
 *
 * Deliberately does NOT itself assert anything about layout or opacity —
 * callers add their own state-based check afterwards (bounding box fully
 * inside the viewport for the drawer, computed `opacity === '1'` for the
 * dialog) so a regression that reaches `finished` but still renders wrong
 * fails loudly instead of the capture silently passing.
 */
export async function waitForAnimationsSettled(
  target: Locator,
  timeout = 5_000,
): Promise<void> {
  await target.evaluate(async (el, timeoutMs: number) => {
    const deadline = performance.now() + timeoutMs;
    while (
      el.getAnimations({ subtree: true }).length === 0 &&
      performance.now() < deadline
    ) {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    }
    await Promise.all(
      el
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  }, timeout);
}

// ---------------------------------------------------------------------------
// Data — prototype-brief.md:42-69
// ---------------------------------------------------------------------------

/** One `InstalledMcpServer` row (`mcp-directory.types.ts:257-298`). */
function mcpRow(over: {
  serverKey: string;
  target?: string;
  origin: 'harness-config' | 'claude-user';
  originLabel: string;
  removal: 'ptah-managed' | 'none';
  removalBlockedReason?: string;
  removalFixCommand?: string;
}): Record<string, unknown> {
  return {
    serverKey: over.serverKey,
    ...(over.target ? { target: over.target } : {}),
    configPath:
      over.origin === 'claude-user'
        ? 'C:\\Users\\dev\\.claude.json'
        : `C:\\Users\\dev\\.ptah\\mcp\\${over.serverKey}.json`,
    config: { type: 'stdio', command: 'npx', args: ['-y', over.serverKey] },
    managedByPtah: over.origin === 'harness-config',
    origin: over.origin,
    originLabel: over.originLabel,
    removal: over.removal,
    ...(over.removalBlockedReason
      ? { removalBlockedReason: over.removalBlockedReason }
      : {}),
    ...(over.removalFixCommand
      ? { removalFixCommand: over.removalFixCommand }
      : {}),
  };
}

/**
 * The brief's table, one row per (serverKey, target) pair — grouping into
 * `InstalledServerGroup`s (one card/row per serverKey with multiple targets)
 * is `installed-mcp-groups.ts`'s job on the client, not this fixture's.
 */
export const INSTALLED_SERVERS_FIXTURE: readonly Record<string, unknown>[] = [
  ...['antigravity', 'claude', 'codex'].map((target) =>
    mcpRow({
      serverKey: 'ptah',
      target,
      origin: 'harness-config',
      originLabel: 'Config file',
      removal: 'ptah-managed',
    }),
  ),
  ...['claude', 'vscode'].map((target) =>
    mcpRow({
      serverKey: 'firecrawl',
      target,
      origin: 'harness-config',
      originLabel: 'Config file',
      removal: 'ptah-managed',
    }),
  ),
  mcpRow({
    serverKey: 'davinci-resolve',
    target: 'claude',
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
  }),
  ...['claude', 'vscode'].map((target) =>
    mcpRow({
      serverKey: 'shopify-dev-mcp',
      target,
      origin: 'harness-config',
      originLabel: 'Config file',
      removal: 'ptah-managed',
    }),
  ),
  mcpRow({
    serverKey: 'node_repl',
    target: 'codex',
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
  }),
  mcpRow({
    serverKey: 'sequential-thinking',
    target: 'vscode',
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
  }),
  mcpRow({
    serverKey: 'angular-cli',
    target: 'vscode',
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
  }),
  mcpRow({
    serverKey: 'chrome-devtools',
    target: 'vscode',
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
  }),
  mcpRow({
    serverKey: 'daisyui',
    target: 'vscode',
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
  }),
  mcpRow({
    serverKey: 'sentry',
    target: 'claude',
    origin: 'claude-user',
    originLabel: 'Claude CLI',
    removal: 'none',
    removalBlockedReason:
      '"sentry" is declared in ~/.claude.json, which belongs to the Claude ' +
      'CLI — Ptah reads it and never writes it.',
    removalFixCommand: 'claude mcp remove sentry',
  }),
  mcpRow({
    serverKey: 'sonarqube',
    target: 'claude',
    origin: 'claude-user',
    originLabel: 'Claude CLI',
    removal: 'none',
    removalBlockedReason:
      '"sonarqube" is declared in ~/.claude.json, which belongs to the ' +
      'Claude CLI — Ptah reads it and never writes it.',
    removalFixCommand: 'claude mcp remove sonarqube',
  }),
];

/** A reduced installed set — the "workspace B" answer for the switch test. */
export const INSTALLED_SERVERS_FIXTURE_AFTER_SWITCH: readonly Record<
  string,
  unknown
>[] = [
  mcpRow({
    serverKey: 'firecrawl',
    target: 'claude',
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
  }),
];

// ---------------------------------------------------------------------------
// Server-detail Overview-row geometry stress data — Revise round 2 part B2,
// Batch 25b regression (`e27935086`, "wrap long values in the server detail
// rows").
// ---------------------------------------------------------------------------

/**
 * The server key the geometry-stress row uses. Distinct from every key in
 * {@link INSTALLED_SERVERS_FIXTURE} so this test can be added to the base
 * fixture set without perturbing any other test's row/card count.
 */
export const STRESS_SERVER_KEY = 'stress-geometry-server';

/**
 * An unbroken ~95-character raw status string with no whitespace to wrap
 * on — the exact stress shape Batch 25b's own investigation probe used
 * (`batch-25b-evidence/probe.e2e.spec.ts.txt`, "A raw `unknown` status
 * text from a live source"). Real product code path, not a DOM hack: fed
 * through `mcpDirectory:listSmitheryConnections`' `status` field below, it
 * reaches the page exactly the way a live Smithery connection would.
 */
export const STRESS_STATUS_TEXT =
  'handshake failed: ECONNREFUSED 127.0.0.1:43117 while probing the stdio transport of this server';

/**
 * One `InstalledMcpServer` row with `origin: 'smithery'` and a long,
 * unbroken config path — the second stress value Batch 25b's probe used.
 * `origin: 'smithery'` is required for {@link STRESS_SMITHERY_CONNECTION}'s
 * status to actually reach this row: `ConnectorLinksStore.statusFor`
 * (`connector-links.store.ts:354-366`) only decorates `smithery`-origin
 * rows from its `smitheryByKey()` map.
 */
export const STRESS_SERVER_ROW: Record<string, unknown> = {
  serverKey: STRESS_SERVER_KEY,
  configPath:
    'C:\\Users\\dev\\.ptah\\mcp\\' + 'very-long-server-name-'.repeat(4) + '.json',
  config: { type: 'stdio', command: 'npx', args: ['-y', STRESS_SERVER_KEY] },
  managedByPtah: false,
  origin: 'smithery',
  originLabel: 'Smithery',
  removal: 'smithery',
};

/**
 * The Smithery connection record for {@link STRESS_SERVER_ROW}. `status`
 * is deliberately NOT one of `SMITHERY_STATUSES`' known literals
 * (`provider-row.ts:413-419`: `connected`/`disconnected`/`auth_required`/
 * `input_required`/`error`) — `known()`'s fallback then sets
 * `statusText: raw`, so {@link STRESS_STATUS_TEXT} reaches
 * `server.statusText` and renders verbatim as the status pill's label
 * (`ptah-status-pill [statusText]`), the exact field the pre-25b template
 * could not shrink below (no `min-w-0` on the Status `dd`).
 */
export const STRESS_SMITHERY_CONNECTION: Record<string, unknown> = {
  connectionId: 'stress-connection-1',
  name: STRESS_SERVER_KEY,
  status: STRESS_STATUS_TEXT,
  managedByPtah: true,
  serverKey: STRESS_SERVER_KEY,
};

/**
 * `baseMarketplaceFixtures()` plus the geometry-stress server above,
 * wired into `mcpDirectory:listInstalled` (appended, not replacing) and
 * `mcpDirectory:listSmitheryConnections`. Kept as a SEPARATE function
 * (rather than folding the stress row into `INSTALLED_SERVERS_FIXTURE`
 * itself) so no existing test's row/card `toHaveCount(...)` assertion
 * shifts by one.
 */
export function geometryStressFixtures(
  workspaceFolders: readonly string[] = ['C:\\ptah-e2e-ws-a'],
): Record<string, unknown> {
  return {
    ...baseMarketplaceFixtures(workspaceFolders),
    'mcpDirectory:listInstalled': {
      servers: [...INSTALLED_SERVERS_FIXTURE, STRESS_SERVER_ROW],
    },
    'mcpDirectory:listSmitheryConnections': {
      connections: [STRESS_SMITHERY_CONNECTION],
      namespace: 'ptah-e2e-ws-a',
    },
  };
}

/** 9 Ptah plugins, 6 enabled (`prototype-brief.md:66-67`). */
export const PLUGINS_FIXTURE = {
  list: {
    plugins: [
      'ptah-core',
      'ptah-frontend',
      'ptah-backend',
      'ptah-creative',
      'ptah-harness',
      'ptah-external-a',
      'ptah-external-b',
      'ptah-external-c',
      'ptah-external-d',
    ].map((id, i) => ({
      id,
      name: id,
      description: `${id} plugin`,
      category: i < 5 ? 'core-tools' : 'external-tools',
      skillCount: 3,
      commandCount: 1,
      isDefault: i < 5,
      keywords: [id],
    })),
  },
  config: {
    enabledPluginIds: [
      'ptah-core',
      'ptah-frontend',
      'ptah-backend',
      'ptah-creative',
      'ptah-harness',
      'ptah-external-a',
    ],
    disabledSkillIds: [],
    disabledPluginIds: [],
  },
};

/** 14 installed skills.sh skills (`prototype-brief.md:68`). */
export const COMMUNITY_SKILLS_FIXTURE = {
  skills: Array.from({ length: 14 }, (_, i) => ({
    name: `community-skill-${i + 1}`,
    description: `Community skill ${i + 1}`,
    source: 'skills-sh/community',
    path: `C:\\Users\\dev\\.ptah\\plugins\\community-skill-${i + 1}`,
    scope: 'global',
  })),
};

/** 3 installed external-marketplace plugins (`prototype-brief.md:69`). */
export const MARKETPLACES_FIXTURE = {
  marketplaces: [
    {
      source: 'dotnet-agent-skills/dotnet-agent-skills',
      name: 'dotnet-agent-skills',
      owner: 'dotnet-agent-skills',
      pluginCount: 5,
      addedAt: '2026-01-01T00:00:00.000Z',
      lastFetchedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  suggestions: [],
  installed: [
    {
      id: 'external:dotnet-agent-skills/dotnet-agent-skills/ef-core',
      name: 'EF Core skills',
      description: 'Entity Framework Core skills',
      source: 'dotnet-agent-skills/dotnet-agent-skills',
      path: 'plugins/ef-core',
      version: '1.0.0',
    },
    {
      id: 'external:dotnet-agent-skills/dotnet-agent-skills/blazor',
      name: 'Blazor skills',
      description: 'Blazor skills',
      source: 'dotnet-agent-skills/dotnet-agent-skills',
      path: 'plugins/blazor',
      version: '1.1.0',
    },
    {
      id: 'external:dotnet-agent-skills/dotnet-agent-skills/minimal-api',
      name: 'Minimal API skills',
      description: 'Minimal API skills',
      source: 'dotnet-agent-skills/dotnet-agent-skills',
      path: 'plugins/minimal-api',
      version: '0.9.0',
    },
  ],
};

/**
 * MCP Registry entries — the allowlisted Sentry listing and a look-alike,
 * verbatim from `mcp-directory-browser.component.spec.ts`'s "gives a vendor
 * mark only to an allowlisted namespace" case (Batch 24a), so the fixture
 * matches the exact allowlist the unit spec already pins.
 */
export const REGISTRY_ENTRIES_FIXTURE = {
  servers: [
    {
      name: 'io.github.getsentry/sentry',
      description: 'Sentry error tracking MCP server',
      repository: {
        url: 'https://github.com/getsentry/sentry-mcp',
        id: 'getsentry/sentry-mcp',
      },
      version_detail: {
        version: '1.0.0',
        packages: [{ registry_name: 'npm', name: '@sentry/mcp-server' }],
        transports: [{ type: 'stdio' }],
      },
    },
    {
      name: 'attacker/github',
      description: 'Not actually GitHub',
      repository: {
        url: 'https://github.com/attacker/github',
        id: 'attacker/github',
      },
      version_detail: {
        version: '0.0.1',
        packages: [{ registry_name: 'npm', name: 'attacker-github' }],
        transports: [{ type: 'stdio' }],
      },
    },
  ],
};

/** `harness:get-skill-selection` — renders the dashboard picker card. */
export const SKILL_SELECTION_FIXTURE = { mode: 'selected', slugs: [] };

/**
 * `mcpDirectory:smitheryAccount` (`McpDirectorySmitheryAccountResult`,
 * `mcp-directory.types.ts:460-468`) — a configured account with one
 * namespace, so `SmitherySurfaceComponent` (`smithery-surface.component.ts:851`)
 * leaves its loading branch and renders the storefront grid instead of
 * spinning forever. Added in Revise round 1 (visual-review.md Serious #1 —
 * this method had no fixture entry at all, so the component never left its
 * loading state in any of the 6 Smithery captures).
 */
export const SMITHERY_ACCOUNT_FIXTURE = {
  configured: true,
  namespaces: ['ptah-e2e-ws-a'],
  activeNamespace: 'ptah-e2e-ws-a',
};

/**
 * `mcpDirectory:getSmitheryKeyStatus` (`McpDirectoryGetSmitheryKeyStatusResult`,
 * `mcp-directory.types.ts:816-818`) — gates `SmitherySurfaceComponent.keyStatus`
 * (`smithery-surface.component.ts:1301-1324`), which is what actually decides
 * whether the "Connect Smithery" prompt, the resolving spinner, or the browse
 * grid renders. `mcpDirectory:smitheryAccount` alone does NOT unblock the
 * Smithery view — `checkKeyStatus()` calls THIS method first and only fires
 * `loadAccount()`/`runBrowse()`/etc. once it resolves `configured: true`.
 * Found the same way as `plugins:list-skills` (instrumented repro): without
 * this fixture the view is stuck on its "resolving key status" spinner
 * indefinitely (no `timeout` option is passed to this call, so it is the
 * default 30s RPC timeout, not even the 10s budget the plugin catalog got).
 */
export const SMITHERY_KEY_STATUS_FIXTURE = { configured: true };

/**
 * `skillsSh:getPopular` (`{ skills: SkillShEntry[] }`, `rpc-agents.types.ts:11-34`)
 * — the "Recommended for your project" section's data source
 * (`skill-sh-browser.component.ts:500`), distinct from `skillsSh:listInstalled`
 * (the already-installed set). Added in Revise round 1 (visual-review.md
 * Serious #2 — this method had no fixture entry, so the section never left
 * its skeleton state in any of the 6 Community captures).
 */
export const SKILLS_SH_POPULAR_FIXTURE = {
  skills: [
    {
      source: 'vercel-labs/skills',
      skillId: 'find-skills',
      name: 'Find Skills',
      description: 'Discover skills relevant to the current task.',
      installs: 4210,
      isInstalled: false,
    },
    {
      source: 'anthropics/skills',
      skillId: 'pdf-forms',
      name: 'PDF Forms',
      description: 'Fill and extract data from PDF forms.',
      installs: 3170,
      isInstalled: false,
    },
    {
      source: 'skills-sh/community',
      skillId: 'sql-review',
      name: 'SQL Review',
      description: 'Review SQL migrations for common mistakes.',
      installs: 980,
      isInstalled: false,
    },
    {
      source: 'skills-sh/community',
      skillId: 'changelog-writer',
      name: 'Changelog Writer',
      description: 'Draft a changelog entry from a diff.',
      installs: 640,
      isInstalled: false,
    },
  ],
};

/**
 * `skillsSh:detectRecommended` (`SkillDetectionResult`, `rpc-agents.types.ts:75-84`)
 * — the "Recommended for your project" section's OWN data source
 * (`skill-sh-browser.component.ts:519`), a THIRD skills.sh method distinct
 * from `skillsSh:listInstalled` and `skillsSh:getPopular`. Found by the same
 * instrumented repro as `plugins:list-skills` above: the Community source
 * page's "Popular skills" section resolved correctly once
 * `skillsSh:getPopular` was fixtured (Revise round 1 item 1), but
 * "Recommended for your project" kept its own 3-card skeleton indefinitely
 * because this fourth method had no fixture entry either.
 */
export const SKILLS_SH_RECOMMENDED_FIXTURE = {
  detectedTechnologies: {
    frameworks: ['Angular'],
    languages: ['TypeScript'],
    tools: ['Nx'],
  },
  recommendedSkills: [
    {
      source: 'anthropics/skills',
      skillId: 'angular-testing',
      name: 'Angular Testing',
      description: 'Write and review Angular component and service tests.',
      installs: 2100,
      isInstalled: false,
    },
    {
      source: 'vercel-labs/skills',
      skillId: 'nx-monorepo',
      name: 'Nx Monorepo',
      description: 'Navigate and refactor an Nx workspace safely.',
      installs: 1560,
      isInstalled: false,
    },
  ],
};

/**
 * One `HarnessTargetHealth` row (`harness-sync.types.ts:110-142`). Every
 * facet reports `'supported'`: none of the fixtured targets is Codex/Copilot
 * (the two with a real `'unsupported'` facet), so a uniform matrix is
 * honest, not a shortcut.
 */
function harnessTargetHealth(
  target: string,
  detected: boolean,
  count: number,
): Record<string, unknown> {
  return {
    target,
    detected,
    facets: { skills: 'supported', commands: 'supported', agents: 'supported', mcp: 'supported' },
    expected: detected ? count : 0,
    found: detected ? count : 0,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
  };
}

/**
 * `harness:health` (`HarnessHealthResult`, `harness-sync.types.ts:371-377`)
 * — three detected, in-sync targets (`claude`/`vscode`/`codex`), the rest
 * undetected in this fixture workspace. `summary` matches `targets` by hand
 * rather than importing `summarizeHarnessHealth` (the e2e harness fixture
 * layer has no dependency on `@ptah-extension/shared`'s reducer logic, only
 * its types). Added in Revise round 1 (visual-review.md Serious #4 — this
 * method had no fixture entry at all, so the Overview "Harness health" KPI
 * card and its per-CLI chips never left their loading skeleton in any
 * capture).
 */
export const HARNESS_HEALTH_FIXTURE = {
  health: {
    workspaceRoot: 'C:\\ptah-e2e-ws-a',
    generatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'full',
    reason: 'activation',
    sources: 'ok',
    collisions: [],
    targets: [
      harnessTargetHealth('claude', true, 12),
      harnessTargetHealth('vscode', true, 8),
      harnessTargetHealth('codex', true, 5),
      harnessTargetHealth('copilot', false, 0),
      harnessTargetHealth('cursor', false, 0),
      harnessTargetHealth('antigravity', false, 0),
      harnessTargetHealth('opencode', false, 0),
    ],
  },
  summary: {
    level: 'ok',
    detectedTargets: 3,
    expected: 25,
    found: 25,
    missing: 0,
    writeFailed: 0,
    foreign: 0,
    removed: 0,
    collisions: 0,
    sources: 'ok',
    label: 'Harness in sync across 3 targets',
  },
  cached: true,
};

/**
 * `plugins:list-skills` (`{ skills: PluginSkillEntry[] }`, `rpc-misc.types.ts:542-561`)
 * — `PluginCatalogPanelComponent.loadPlugins()` (`plugin-catalog-panel.component.ts:1126-1130`)
 * calls this UNCONDITIONALLY once `PluginCatalogService`'s catalog resolves
 * with `plugins.length > 0`, to fetch each plugin's per-skill list. This
 * method had NO fixture entry — it is not one of the three named in Revise
 * round 1 item 1, but it is the ACTUAL root cause of "Ptah Plugins never
 * leaves its loading skeleton" (visual-review.md Serious #3 / batch report
 * "Product defects found #2"): `plugins:get-config`/`plugins:list-available`
 * were always fixtured and always resolved correctly — proven by
 * instrumenting the real service during root-causing this — but the
 * component's OWN follow-up `await this.rpcService.call('plugins:list-skills', ...)`
 * was left unanswered by the "unfixtured methods get no response" harness
 * convention, so it sat on its own 10s RPC timeout before the panel's
 * `finally` block ever flipped `isLoading` back to `false`. A capture taken
 * well under 10s therefore always shows the skeleton, deterministically, no
 * matter how long the wait — this is a MISSING FIXTURE, not a
 * `PluginCatalogService` scope race (see batch-25-report.md's "Revise round
 * 1" section for the full instrumented repro).
 */
function pluginSkillsResolver(): RpcFixtureResolver {
  return (params) => {
    const ids =
      (params as { pluginIds?: readonly string[] } | null | undefined)
        ?.pluginIds ?? [];
    const skills: Record<string, unknown>[] = [];
    for (const pluginId of ids) {
      for (let i = 1; i <= 3; i++) {
        skills.push({
          skillId: pluginId + '-skill-' + i,
          descriptorId: pluginId + ':' + pluginId + '-skill-' + i,
          invocationName: pluginId + '-skill-' + i,
          displayName: pluginId + ' Skill ' + i,
          description: 'A skill bundled with the ' + pluginId + ' plugin.',
          pluginId: pluginId,
          sourceId: pluginId,
          source: 'bundled',
          invocability: 'invocable',
        });
      }
    }
    return { skills };
  };
}

/**
 * The base RPC set every marketplace scenario needs: `workspace:getInfo`
 * (Electron's `ElectronLayoutService.hasWorkspaceFolders()` gate — see the
 * thoth spec's HOST CONFIG NOTE), the four inventory-slice reads (D4), and
 * the plugin catalogue pair `ChatEmptyStateComponent`/`SkillSelectionCard`
 * also depend on. Anything not answered here is deliberately left unanswered
 * (thoth spec convention): the caller's own RPC timeout/loading state handles
 * it without touching an unrelated assertion.
 */
export function baseMarketplaceFixtures(
  workspaceFolders: readonly string[] = ['C:\\ptah-e2e-ws-a'],
): Record<string, unknown> {
  return {
    'workspace:getInfo': {
      folders: [...workspaceFolders],
      activeFolder: workspaceFolders[0],
    },
    'workspace:switch': { success: true },
    'mcpDirectory:listInstalled': { servers: INSTALLED_SERVERS_FIXTURE },
    'mcpDirectory:listOAuthConnected': { servers: [] },
    'mcpDirectory:listSmitheryConnections': {
      connections: [],
      namespace: null,
    },
    'mcpDirectory:oauthStatus': { state: 'disconnected' },
    'mcpDirectory:getPopular': REGISTRY_ENTRIES_FIXTURE,
    'mcpDirectory:search': REGISTRY_ENTRIES_FIXTURE,
    'mcpDirectory:smitheryAccount': SMITHERY_ACCOUNT_FIXTURE,
    'mcpDirectory:getSmitheryKeyStatus': SMITHERY_KEY_STATUS_FIXTURE,
    'skillsSh:listInstalled': COMMUNITY_SKILLS_FIXTURE,
    'skillsSh:getPopular': SKILLS_SH_POPULAR_FIXTURE,
    'skillsSh:detectRecommended': SKILLS_SH_RECOMMENDED_FIXTURE,
    'plugins:list-marketplaces': MARKETPLACES_FIXTURE,
    'plugins:get-config': PLUGINS_FIXTURE.config,
    'plugins:list-available': PLUGINS_FIXTURE.list,
    'plugins:list-skills': pluginSkillsResolver(),
    'harness:get-skill-selection': SKILL_SELECTION_FIXTURE,
    'harness:health': HARNESS_HEALTH_FIXTURE,
  };
}

/**
 * `mcpDirectory:listInstalled` resolver that answers
 * {@link INSTALLED_SERVERS_FIXTURE} on the FIRST call and
 * {@link INSTALLED_SERVERS_FIXTURE_AFTER_SWITCH} on every call after —
 * standing in for "workspace B has fewer servers than workspace A" across a
 * real workspace switch, without a second `addInitScript` round trip. Each
 * call of this factory starts its own count, so one resolver serves one page.
 * See `installRpcAutoResponder`'s doc comment for the resolver mechanism.
 */
export function statefulListInstalledResolver(): RpcFixtureResolver {
  let calls = 0;
  return () => {
    calls += 1;
    return {
      servers:
        calls <= 1
          ? INSTALLED_SERVERS_FIXTURE
          : INSTALLED_SERVERS_FIXTURE_AFTER_SWITCH,
    };
  };
}

/** Every `data-nav-id` the Marketplace nav renders (`marketplace-nav.component.ts`). */
export const MARKETPLACE_NAV_IDS = [
  'overview',
  'connectors',
  'servers',
  'skills',
  'smithery',
  'registry',
  'custom-url',
  'ptah-plugins',
  'community',
  'marketplaces',
] as const;
