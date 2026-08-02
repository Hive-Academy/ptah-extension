/**
 * RPC surface baseline — VS Code extension host.
 *
 * `deriveRpcSurface(profile)` partitions the whole RPC registry into what this
 * host serves and what it excludes. The excluded list below is the frozen
 * baseline: it is exactly the hand-maintained exclusion list this host carried
 * before TASK_2026_171 replaced it with manifest x profile derivation.
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
import { deriveRpcSurface } from '@ptah-extension/rpc-handlers';

import { createVscodeRpcHostProfile } from '../rpc-host-profile';

const NOOP_LOGGER = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
} as unknown as Parameters<typeof createVscodeRpcHostProfile>[0];

/** Electron-only surfaces: desktop editor pane, raw FS, layout, PTY, updater,
 *  workspace lifecycle, and every SQLite/native-backed subsystem. */
export const VSCODE_EXPECTED_ABSENT_METHODS: readonly string[] = [
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
  'editor:createFile',
  'editor:createFolder',
  'editor:deleteItem',
  'editor:getDirectoryChildren',
  'editor:getFileTree',
  'editor:getSetting',
  'editor:listAllFiles',
  'editor:openFile',
  'editor:renameItem',
  'editor:saveFile',
  'editor:searchInFiles',
  'editor:updateSetting',
  'embedder:retry',
  'embedder:status',
  'file:exists',
  'file:read',
  'file:save-dialog',
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
  'layout:persist',
  'layout:restore',
  'mem:getObservations',
  'mem:searchIndex',
  'mem:timeline',
  'memory:diagnostics',
  'memory:forget',
  'memory:get',
  'memory:getTriggers',
  'memory:list',
  'memory:pin',
  'memory:purgeBySubjectPattern',
  'memory:purgeJunk',
  'memory:rebuildIndex',
  'memory:runNow',
  'memory:search',
  'memory:searchSymbols',
  'memory:setTriggers',
  'memory:stats',
  'memory:unpin',
  'skillSynthesis:acceptSuggestion',
  'skillSynthesis:analyzeNow',
  'skillSynthesis:clearStaleSpecs',
  'skillSynthesis:diagnostics',
  'skillSynthesis:dismissSuggestion',
  'skillSynthesis:enhanceNow',
  'skillSynthesis:getCandidate',
  'skillSynthesis:getClone',
  'skillSynthesis:getScorecardDetail',
  'skillSynthesis:getScorecards',
  'skillSynthesis:getSettings',
  'skillSynthesis:getSuggestion',
  'skillSynthesis:getTriggers',
  'skillSynthesis:harvestSpecs',
  'skillSynthesis:invocationStats',
  'skillSynthesis:invocations',
  'skillSynthesis:keepClone',
  'skillSynthesis:listCandidates',
  'skillSynthesis:listClones',
  'skillSynthesis:listSpecs',
  'skillSynthesis:listSuggestions',
  'skillSynthesis:pin',
  'skillSynthesis:promote',
  'skillSynthesis:promoteBulk',
  'skillSynthesis:rebaseClone',
  'skillSynthesis:reject',
  'skillSynthesis:rejectBulk',
  'skillSynthesis:rejectByPattern',
  'skillSynthesis:revertEnhancement',
  'skillSynthesis:runCurator',
  'skillSynthesis:setTriggers',
  'skillSynthesis:stats',
  'skillSynthesis:unpin',
  'skillSynthesis:updateSettings',
  'skillSynthesis:updateSuggestion',
  'terminal:create',
  'terminal:kill',
  'update:check-now',
  'update:get-state',
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
  'workspace:registerFolder',
  'workspace:removeFolder',
  'workspace:switch',
];

describe('VS Code RPC surface', () => {
  const surface = deriveRpcSurface(createVscodeRpcHostProfile(NOOP_LOGGER));

  it('excludes exactly the pre-refactor Electron-only method list', () => {
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
