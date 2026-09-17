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
