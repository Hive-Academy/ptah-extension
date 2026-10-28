/**
 * RPC surface baseline — headless CLI / TUI hosts.
 *
 * `deriveRpcSurface(profile)` partitions the whole RPC registry into what this
 * host serves and what it excludes. The excluded names below preserve the
 * hand-maintained baseline this host carried before TASK_2026_171 replaced it
 * with manifest x profile derivation, plus
 * `update:get-state` and `update:check-now` — two methods the headless hosts
 * never registered but had also never declared, so every CLI boot reported
 * them as registration drift. The editor RPC surface (including
 * `editor:revertFiles`) was removed entirely in TASK_2026_385 Batch 4.4 and
 * no longer appears in `RPC_METHOD_NAMES` at all.
 *
 * This doubles as the host's expected-ABSENT list — a method appearing here
 * must NOT be reachable on this host.
 *
 * When a genuinely new method lands in the manifest, add it here if this host
 * cannot serve it; otherwise the partition assertion proves it is served.
 */

import 'reflect-metadata';

import {
  deriveRpcSurface,
  RPC_HANDLER_MANIFEST,
  resolveRpcHandlerPlan,
} from '@ptah-extension/rpc-handlers';

import { createCliRpcHostProfile } from './cli-host-profile';
import {
  CLI_ONLY_ABSENT_CAPABILITIES,
  EXPECTED_ABSENT_CAPABILITIES,
} from './expected-absent';

/** Webview-only surfaces: pickers, command palette, embedded PTY,
 *  desktop updater. Every backend subsystem stays on. */
const EXPECTED_ABSENT_METHOD_NAMES: readonly string[] = [
  // Lane plan-limit read (TASK_2026_623 R10.9) — `lanePlanLimits` capability is
  // Electron-only, see expected-absent.ts.
  'agent:getLanePlanLimits',
  'command:execute',
  'file:exists',
  'file:open',
  'file:pick',
  'file:pick-images',
  'file:read',
  'file:save-dialog',
  'file:saveContent',
  'file:viewContent',
  // Claude account management (TASK_2026_712 D30) — `providerAccounts`
  // capability is Electron-only, see expected-absent.ts.
  'provider:addAccount',
  'provider:cancelAccountSignIn',
  'provider:getAccountStatus',
  'provider:getAmbientClaudeStatus',
  'provider:listAccounts',
  'provider:removeAccount',
  'provider:renameAccount',
  'provider:setAccountDefault',
  'provider:setAccountSelection',
  'provider:signOutAccount',
  'provider:startAccountSignIn',
  'update:check-now',
  'update:get-state',
  'update:mark-downloaded',
];

const manifestMethods = RPC_HANDLER_MANIFEST.flatMap((entry) => [
  ...entry.methods,
]).sort();
const liveMethodNames = new Set<string>(manifestMethods);
export const CLI_EXPECTED_ABSENT_METHODS: readonly string[] =
  EXPECTED_ABSENT_METHOD_NAMES.filter((name) => liveMethodNames.has(name));

describe('CLI RPC surface', () => {
  const surface = deriveRpcSurface(createCliRpcHostProfile('cli'));

  it('serves artifact methods with the optional store absent', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining(['artifacts:list', 'artifacts:openLink']),
    );
  });

  it('serves bound guidance and generation recovery methods', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'attention:getSnapshot',
        'enhancedPrompts:cancel',
        'enhancedPrompts:getRunState',
        'wizard:get-generation-run-state',
      ]),
    );
  });

  it('serves the community pack install plan (TASK_2026_701 B8)', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'wizard:plan-pack-install',
        'wizard:install-pack-agents',
      ]),
    );
    expect(surface.excluded).not.toContain('wizard:plan-pack-install');
  });

  it('serves the plugin kept-item and config-home methods (TASK_2026_701 B12)', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'plugins:replace-kept-items',
        'plugins:resolve-config-home',
      ]),
    );
    expect(surface.excluded).not.toContain('plugins:replace-kept-items');
    expect(surface.excluded).not.toContain('plugins:resolve-config-home');
  });

  it('excludes exactly the live webview-only surface methods', () => {
    expect([...surface.excluded]).toEqual([...CLI_EXPECTED_ABSENT_METHODS]);
  });

  it('partitions the RPC registry with no overlap or gap', () => {
    expect(surface.registered.length + surface.excluded.length).toBe(
      manifestMethods.length,
    );
    const registered = new Set(surface.registered);
    expect(surface.excluded.filter((m) => registered.has(m))).toEqual([]);
  });

  it('serves every backend-subsystem namespace', () => {
    const namespaces = [
      'cron:',
      'gateway:',
      'voice:',
      'memory:',
      'mem:',
      'corpus:',
      'skillSynthesis:',
      'db:',
      'embedder:',
      'indexing:',
      'workspace:',
    ];
    for (const ns of namespaces) {
      if (
        ns === 'skillSynthesis:' &&
        !manifestMethods.some((method) => method.startsWith(ns))
      ) {
        continue;
      }
      expect(surface.registered.some((m) => m.startsWith(ns))).toBe(true);
      expect(surface.excluded.some((m) => m.startsWith(ns))).toBe(false);
    }
  });

  it('serves external-editor launch without enabling the host file opener', () => {
    const profile = createCliRpcHostProfile('cli');

    expect(profile.capabilities.editorLauncher).toBe(true);
    expect(profile.capabilities.fileOpen).toBe(false);
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'editor:detectTargets',
        'editor:openFile',
        'editor:openWorkspace',
      ]),
    );
    expect(surface.excluded).toContain('file:open');
  });
});

describe('CLI / TUI host parity', () => {
  it('boots the TUI as its own RPC host', () => {
    expect(createCliRpcHostProfile('tui').host).toBe('tui');
    expect(createCliRpcHostProfile().host).toBe('cli');
  });

  it.each([['cli'], ['tui']] as const)(
    '%s keeps every webview-only capability off',
    (host) => {
      const profile = createCliRpcHostProfile(host);
      for (const capability of EXPECTED_ABSENT_CAPABILITIES) {
        expect(profile.capabilities[capability]).toBe(false);
      }
    },
  );

  it('serves file:pick on the TUI but not the stdio CLI', () => {
    const tui = deriveRpcSurface(createCliRpcHostProfile('tui'));
    const cli = deriveRpcSurface(createCliRpcHostProfile('cli'));

    expect(tui.registered).toContain('file:pick');
    expect(cli.excluded).toContain('file:pick');

    for (const capability of CLI_ONLY_ABSENT_CAPABILITIES) {
      expect(createCliRpcHostProfile('cli').capabilities[capability]).toBe(
        false,
      );
    }
  });

  it('withholds file:pick-images from both — neither can attach image bytes', () => {
    for (const host of ['cli', 'tui'] as const) {
      expect(
        deriveRpcSurface(createCliRpcHostProfile(host)).excluded,
      ).toContain('file:pick-images');
    }
  });

  it('differs from the stdio CLI by exactly file:pick', () => {
    const tui = new Set(
      deriveRpcSurface(createCliRpcHostProfile('tui')).excluded,
    );
    const cli = deriveRpcSurface(createCliRpcHostProfile('cli')).excluded;
    expect(cli.filter((m) => !tui.has(m))).toEqual(['file:pick']);
  });

  it.each([['cli'], ['tui']] as const)(
    '%s resolves a handler plan with no unimplemented entry',
    (host) => {
      expect(() =>
        resolveRpcHandlerPlan(createCliRpcHostProfile(host)),
      ).not.toThrow();
    },
  );
});
