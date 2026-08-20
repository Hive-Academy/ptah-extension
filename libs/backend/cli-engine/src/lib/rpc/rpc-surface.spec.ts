/**
 * RPC surface baseline — headless CLI / TUI hosts.
 *
 * `deriveRpcSurface(profile)` partitions the whole RPC registry into what this
 * host serves and what it excludes. The excluded list below is the frozen
 * baseline: it is exactly the hand-maintained exclusion list this host carried
 * before TASK_2026_171 replaced it with manifest x profile derivation, plus `editor:revertFiles`, `update:get-state` and `update:check-now`
 * — three methods the headless hosts never registered but had also never
 * declared, so every CLI boot reported them as registration drift.
 *
 * This doubles as the host's expected-ABSENT list — a method appearing here
 * must NOT be reachable on this host.
 *
 * When a genuinely new method lands in `RPC_METHOD_NAMES`, exactly one of the
 * two lists must move: add it here if this host cannot serve it, otherwise the
 * partition assertion below proves it is served.
 */

import 'reflect-metadata';

import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import {
  deriveRpcSurface,
  resolveRpcHandlerPlan,
} from '@ptah-extension/rpc-handlers';

import { createCliRpcHostProfile } from './cli-host-profile';
import {
  CLI_ONLY_ABSENT_CAPABILITIES,
  EXPECTED_ABSENT_CAPABILITIES,
} from './expected-absent';

/** Webview-only surfaces: pickers, command palette, editor pane, persisted
 *  layout, embedded PTY, desktop updater. Every backend subsystem stays on. */
export const CLI_EXPECTED_ABSENT_METHODS: readonly string[] = [
  'command:execute',
  'editor:createFile',
  'editor:createFolder',
  'editor:deleteItem',
  'editor:getDirectoryChildren',
  'editor:getFileTree',
  'editor:getSetting',
  'editor:listAllFiles',
  'editor:openFile',
  'editor:renameItem',
  'editor:revertFiles',
  'editor:saveFile',
  'editor:searchInFiles',
  'editor:updateSetting',
  'file:exists',
  'file:open',
  'file:pick',
  'file:pick-images',
  'file:read',
  'file:save-dialog',
  'layout:persist',
  'layout:restore',
  'terminal:create',
  'terminal:kill',
  'update:check-now',
  'update:get-state',
];

describe('CLI RPC surface', () => {
  const surface = deriveRpcSurface(createCliRpcHostProfile('cli'));

  it('excludes exactly the webview-only surface methods', () => {
    expect([...surface.excluded]).toEqual([...CLI_EXPECTED_ABSENT_METHODS]);
  });

  it('partitions the RPC registry with no overlap or gap', () => {
    expect(surface.registered.length + surface.excluded.length).toBe(
      RPC_METHOD_NAMES.length,
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
      expect(surface.registered.some((m) => m.startsWith(ns))).toBe(true);
      expect(surface.excluded.some((m) => m.startsWith(ns))).toBe(false);
    }
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
