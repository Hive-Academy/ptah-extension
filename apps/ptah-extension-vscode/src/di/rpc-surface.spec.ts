/**
 * RPC surface baseline — VS Code extension host.
 *
 * `deriveRpcSurface(profile)` partitions the whole RPC registry into what this
 * host serves and what it excludes. The excluded names below preserve the
 * hand-maintained baseline this host carried before TASK_2026_171 replaced it
 * with manifest x profile derivation. Only names still in the live RPC method
 * registry participate in the expectation.
 *
 * This doubles as the host's expected-ABSENT list — a method appearing here
 * must NOT be reachable on this host.
 *
 * When a genuinely new method lands in `RPC_METHOD_NAMES`, add it here if this
 * host cannot serve it; otherwise the partition assertion proves it is served.
 */

import 'reflect-metadata';

import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { deriveRpcSurface } from '@ptah-extension/rpc-handlers';

import { createVscodeRpcHostProfile } from '../rpc-host-profile';

const NOOP_LOGGER = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
} as unknown as Parameters<typeof createVscodeRpcHostProfile>[0];

/** Electron-only surfaces: raw FS, PTY, updater, workspace lifecycle, and
 *  every SQLite/native-backed subsystem. */
const EXPECTED_ABSENT_METHOD_NAMES: readonly string[] = [
  // Lane plan-limit read (TASK_2026_623 R10.9) — `lanePlanLimits` capability is
  // Electron-only, see expected-absent.ts.
  'agent:getLanePlanLimits',
  'corpus:build',
  'corpus:delete',
  'corpus:get',
  'corpus:list',
  'corpus:prime',
  'corpus:query',
  'corpus:rebuild',
  'corpus:reprime',
  'corpus:suggest',
  'cron:create',
  'cron:delete',
  'cron:get',
  'cron:list',
  'cron:nextFire',
  'cron:runNow',
  'cron:runs',
  'cron:toggle',
  'cron:update',
  'db:health',
  'db:openBindingFolder',
  'db:reloadVec',
  'db:reset',
  // Per-workspace `go vet` consent (TASK_2026_559 Batch 37b, O2 §3/§5.3): VS
  // Code has no consent surface, so `goVetDiagnostics` stays off here.
  'diagnostics:go-vet-consent-get',
  'diagnostics:go-vet-consent-set',
  'embedder:retry',
  'embedder:status',
  'file:exists',
  'file:read',
  'file:save-dialog',
  'file:saveContent',
  'file:viewContent',
  'gateway:approveBinding',
  'gateway:attachSession',
  'gateway:blockBinding',
  'gateway:detachSession',
  'gateway:getAllowList',
  'gateway:getDiscordAppId',
  'gateway:listBindings',
  'gateway:listDiscordGuilds',
  'gateway:listMessages',
  'gateway:registerDiscordCommands',
  'gateway:setAllowList',
  'gateway:setDiscordAppId',
  'gateway:setToken',
  'gateway:start',
  'gateway:status',
  'gateway:stop',
  'gateway:test',
  'indexing:acknowledgeDisclosure',
  'indexing:cancel',
  'indexing:dismissStale',
  'indexing:getStatus',
  'indexing:pause',
  'indexing:resume',
  'indexing:setPipelineEnabled',
  'indexing:start',
  'mem:getObservations',
  'mem:searchIndex',
  'mem:timeline',
  'memory:diagnostics',
  'memory:forget',
  'memory:get',
  'memory:getTriggers',
  'memory:list',
  'memory:listQuarantined',
  'memory:pin',
  'memory:purgeBySubjectPattern',
  'memory:purgeJunk',
  'memory:rebuildIndex',
  'memory:restoreQuarantined',
  'memory:runNow',
  'memory:search',
  'memory:searchSymbols',
  'memory:setTriggers',
  'memory:stats',
  'memory:unpin',
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
  // The whole `skillSynthesis:*` namespace requires the `skillSynthesis`
  // capability (manifest.ts `requires: ['skillSynthesis']`), which
  // `createVscodeRpcHostProfile` never turns on, so this host serves none of it.
  'skillSynthesis:applyProposal',
  'skillSynthesis:clearStaleSpecs',
  // Per-agent model editor (TASK_2026_609) — served only to the desktop
  // Thoth Library Agents tab, like the rest of the namespace.
  'skillSynthesis:getAgentModels',
  'skillSynthesis:getClone',
  'skillSynthesis:getHistoryBody',
  'skillSynthesis:getScorecardDetail',
  'skillSynthesis:getScorecards',
  'skillSynthesis:harvestSpecs',
  'skillSynthesis:invocationStats',
  'skillSynthesis:keepClone',
  'skillSynthesis:listClones',
  // Quarantined-agent listing (TASK_2026_609) — desktop Agents tab only.
  'skillSynthesis:listQuarantinedAgents',
  'skillSynthesis:listSpecs',
  'skillSynthesis:previewEnhancement',
  'skillSynthesis:rebaseClone',
  // Quarantine restore — counterpart of `listQuarantinedAgents`, same reason.
  'skillSynthesis:restoreQuarantinedAgent',
  'skillSynthesis:revertEnhancement',
  // Clone body save — writes into `~/.ptah/user` through
  // `UserLayerMirrorService`, which this host does not bind.
  'skillSynthesis:saveCloneBody',
  // Per-agent model write — counterpart of `getAgentModels`, same reason.
  'skillSynthesis:setAgentModel',
  'update:check-now',
  'update:get-state',
  'update:mark-downloaded',
  'voice:downloadModel',
  'voice:downloadTtsModel',
  'voice:getConfig',
  'voice:getProviderConfig',
  'voice:getTtsConfig',
  'voice:listProviders',
  'voice:listVoices',
  'voice:setApiKey',
  'voice:setConfig',
  'voice:setProviderConfig',
  'voice:setTtsConfig',
  'voice:synthesize',
  'voice:testConnection',
  'voice:transcribe',
  'workspace:addFolder',
  'workspace:getInfo',
  'workspace:listRecent',
  'workspace:registerFolder',
  'workspace:removeFolder',
  'workspace:switch',
];

const liveMethodNames = new Set<string>(RPC_METHOD_NAMES);
export const VSCODE_EXPECTED_ABSENT_METHODS: readonly string[] =
  EXPECTED_ABSENT_METHOD_NAMES.filter((name) => liveMethodNames.has(name));

describe('VS Code RPC surface', () => {
  const surface = deriveRpcSurface(createVscodeRpcHostProfile(NOOP_LOGGER));

  it('serves artifact methods with the optional store absent', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining(['artifacts:list', 'artifacts:openLink']),
    );
  });

  it('serves the displayWindow namespace, answered by the desktop-only host (TASK_2026_853)', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'displayWindow:open',
        'displayWindow:close',
        'displayWindow:status',
        'displayWindow:publishState',
        'displayWindow:getState',
        'displayWindow:action',
      ]),
    );
    expect(surface.excluded.some((m) => m.startsWith('displayWindow:'))).toBe(
      false,
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

  it('excludes exactly the live methods in the VS Code absent list', () => {
    expect([...surface.excluded]).toEqual([...VSCODE_EXPECTED_ABSENT_METHODS]);
  });

  it('partitions the RPC registry with no overlap or gap', () => {
    expect(surface.registered.length + surface.excluded.length).toBe(
      RPC_METHOD_NAMES.length,
    );
    const registered = new Set(surface.registered);
    expect(surface.excluded.filter((m) => registered.has(m))).toEqual([]);
  });
});
