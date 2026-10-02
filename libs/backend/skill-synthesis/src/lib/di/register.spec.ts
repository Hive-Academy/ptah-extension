/**
 * A token declared in `tokens.ts` but never wired in `register.ts` fails only at
 * the first `container.resolve(...)` — at runtime, in whichever host happens to
 * resolve it first, with a message that names a symbol and nothing else. This
 * spec turns that into a compile-and-test failure instead.
 *
 * Registration does not construct anything (tsyringe is lazy), so a bare child
 * container with a stub logger is enough — no SQLite, no workspace provider.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SkillBacklogCleanupService } from '../cleanup/skill-backlog-cleanup.service';
import { SkillBacklogCleanupStore } from '../cleanup/skill-backlog-cleanup.store';
import { SkillBacklogPurgeStateStore } from '../lifecycle/skill-backlog-purge-state.store';
import { SkillRetirementService } from '../lifecycle/skill-retirement.service';
import { SkillUmbrellaMergeService } from '../lifecycle/skill-umbrella-merge.service';
import { SkillCuratorService } from '../skill-curator.service';
import { registerSkillSynthesisServices } from './register';
import {
  PROVIDER_AUTH_RESOLVER_TOKEN,
  SESSION_ACTIVITY_REGISTRY_TOKEN,
  SKILL_SYNTHESIS_TOKENS,
} from './tokens';

const stubLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

describe('registerSkillSynthesisServices', () => {
  it('registers every declared SKILL_SYNTHESIS_TOKENS member', () => {
    const container = rootContainer.createChildContainer();
    registerSkillSynthesisServices(container, stubLogger);

    const unregistered = Object.entries(SKILL_SYNTHESIS_TOKENS)
      .filter(([, token]) => !container.isRegistered(token))
      .map(([name]) => name);

    expect(unregistered).toEqual([]);
  });

  it('resolves the backlog cleanup store and service tokens as singletons', () => {
    // Resolve through the REAL registration twice and compare identity. Only
    // the host-provided tokens the constructors inject are supplied; the
    // constructors store them and touch nothing, so inert stubs suffice.
    const container = rootContainer.createChildContainer();
    container.registerInstance(TOKENS.LOGGER, stubLogger);
    container.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    container.registerInstance(SDK_TOKENS.SDK_JSONL_READER, {});
    container.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {});
    registerSkillSynthesisServices(container, stubLogger);

    const store = container.resolve<SkillBacklogCleanupStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_STORE,
    );
    const service = container.resolve<SkillBacklogCleanupService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_SERVICE,
    );

    expect(store).toBeInstanceOf(SkillBacklogCleanupStore);
    expect(service).toBeInstanceOf(SkillBacklogCleanupService);
    expect(
      container.resolve(SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_STORE),
    ).toBe(store);
    expect(
      container.resolve(SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_SERVICE),
    ).toBe(service);
  });

  it('resolves the backlog purge-state store token as a singleton', () => {
    const container = rootContainer.createChildContainer();
    container.registerInstance(TOKENS.LOGGER, stubLogger);
    container.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    registerSkillSynthesisServices(container, stubLogger);

    const store = container.resolve<SkillBacklogPurgeStateStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_PURGE_STATE_STORE,
    );

    expect(store).toBeInstanceOf(SkillBacklogPurgeStateStore);
    expect(
      container.resolve(SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_PURGE_STATE_STORE),
    ).toBe(store);
    expect(container.resolve(SkillBacklogPurgeStateStore)).toBe(store);
    expect(
      SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_PURGE_STATE_STORE.description,
    ).toBe('PtahSkillBacklogPurgeStateStore');
  });

  it('resolves the retirement service token as a singleton', () => {
    // The optional collaborators (registry, repropagation, workspace) resolve
    // through the real registration; only the host-provided tokens are stubbed.
    const container = rootContainer.createChildContainer();
    container.registerInstance(TOKENS.LOGGER, stubLogger);
    container.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    container.registerInstance(PERSISTENCE_TOKENS.VEC_STATUS, {});
    registerSkillSynthesisServices(container, stubLogger);

    const service = container.resolve<SkillRetirementService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_RETIREMENT_SERVICE,
    );

    expect(service).toBeInstanceOf(SkillRetirementService);
    expect(
      container.resolve(SKILL_SYNTHESIS_TOKENS.SKILL_RETIREMENT_SERVICE),
    ).toBe(service);
    expect(container.resolve(SkillRetirementService)).toBe(service);
    expect(SKILL_SYNTHESIS_TOKENS.SKILL_RETIREMENT_SERVICE.description).toBe(
      'PtahSkillRetirementService',
    );
  });

  it('resolves the umbrella merge service token as a singleton', () => {
    // All eight collaborators resolve through the real registration; only the
    // host-provided tokens are stubbed (constructors store them, touch nothing).
    const container = rootContainer.createChildContainer();
    container.registerInstance(TOKENS.LOGGER, stubLogger);
    container.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    container.registerInstance(PERSISTENCE_TOKENS.VEC_STATUS, {});
    container.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {});
    container.registerInstance(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT, {});
    registerSkillSynthesisServices(container, stubLogger);

    const service = container.resolve<SkillUmbrellaMergeService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_UMBRELLA_MERGE_SERVICE,
    );

    expect(service).toBeInstanceOf(SkillUmbrellaMergeService);
    expect(
      container.resolve(SKILL_SYNTHESIS_TOKENS.SKILL_UMBRELLA_MERGE_SERVICE),
    ).toBe(service);
    expect(container.resolve(SkillUmbrellaMergeService)).toBe(service);
    expect(
      SKILL_SYNTHESIS_TOKENS.SKILL_UMBRELLA_MERGE_SERVICE.description,
    ).toBe('PtahSkillUmbrellaMergeService');
  });

  it('resolves the curator facade with its lifecycle collaborators (R-i)', () => {
    const container = rootContainer.createChildContainer();
    container.registerInstance(TOKENS.LOGGER, stubLogger);
    container.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    container.registerInstance(PERSISTENCE_TOKENS.VEC_STATUS, {});
    container.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {});
    container.registerInstance(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT, {});
    registerSkillSynthesisServices(container, stubLogger);
    // The enhancer needs the host's user-layer mirror; it is not under test
    // here. The umbrella, retirement and promotion collaborators resolve
    // through the real registration.
    container.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE,
      {},
    );

    const curator = container.resolve<SkillCuratorService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE,
    );

    expect(curator).toBeInstanceOf(SkillCuratorService);
    expect(container.resolve(SkillCuratorService)).toBe(curator);
  });

  it('gives the queue and budget stores globally unique token descriptions', () => {
    const descriptions = Object.values(SKILL_SYNTHESIS_TOKENS).map(
      (t) => t.description,
    );
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE.description).toBe(
      'PtahSkillSynthesisQueueStore',
    );
    expect(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE.description).toBe(
      'PtahSkillSynthesisBudgetStore',
    );
  });

  it('gives the drain service and foreground tracker their planned descriptions', () => {
    expect(SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE.description).toBe(
      'PtahSkillSynthesisDrainService',
    );
    expect(SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER.description).toBe(
      'PtahSkillForegroundActivityTracker',
    );
  });

  it('gives the lane resolver its planned description', () => {
    expect(SKILL_SYNTHESIS_TOKENS.LANE_RESOLVER_SERVICE.description).toBe(
      'PtahSkillLaneResolverService',
    );
  });

  it('gives the lane runner its planned description', () => {
    expect(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE.description).toBe(
      'PtahSkillLaneRunnerService',
    );
  });

  it('gives the session-verdict store its planned description', () => {
    expect(SKILL_SYNTHESIS_TOKENS.SESSION_VERDICT_STORE.description).toBe(
      'PtahSkillSessionVerdictStore',
    );
  });

  it('points the provider-auth token at the SDK resolver symbol', () => {
    // Same globally-interned symbol as SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER.
    // This one fails SILENTLY when wrong: the injection is `{isOptional:true}`,
    // so a typo resolves `null` and every lane quietly ignores its configured
    // provider and rides the user's foreground credentials instead — which is
    // precisely the behaviour lanes exist to prevent.
    expect(PROVIDER_AUTH_RESOLVER_TOKEN).toBe(
      Symbol.for('SdkProviderAuthResolver'),
    );
  });

  it('points the session-activity token at the SDK registry symbol', () => {
    // Same globally-interned symbol as SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY.
    // Declared locally to avoid the circular dependency; a typo here would make
    // the tracker silently resolve nothing and never report activity.
    expect(SESSION_ACTIVITY_REGISTRY_TOKEN).toBe(
      Symbol.for('SdkSessionActivityRegistry'),
    );
  });
});
