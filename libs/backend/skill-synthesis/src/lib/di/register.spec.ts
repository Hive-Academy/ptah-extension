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
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { LANE_OUTCOME_TOKENS } from '@ptah-extension/lane-outcomes';
import { SkillTelemetrySeamAdapter } from '../outcome-seam/skill-telemetry-seam.adapter';
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
  it('binds the outcome telemetry seam to one adapter instance', () => {
    const container = rootContainer.createChildContainer();
    container.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    container.registerInstance(PERSISTENCE_TOKENS.VEC_STATUS, {});
    // The seam reads through the owning stores, which inject the host Logger.
    container.registerInstance(TOKENS.LOGGER, stubLogger);
    registerSkillSynthesisServices(container, stubLogger);
    const seam = container.resolve(LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM);
    expect(seam).toBeInstanceOf(SkillTelemetrySeamAdapter);
    expect(container.resolve(LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM)).toBe(
      seam,
    );
  });
  it('registers the retained skill-synthesis tokens', () => {
    const container = rootContainer.createChildContainer();
    registerSkillSynthesisServices(container, stubLogger);

    const retained = [
      'FOREGROUND_ACTIVITY_TRACKER',
      'SKILL_JUDGE_SERVICE',
      'SKILL_TRIGGER_SERVICE',
      'SKILL_INVOCATION_RECORDER',
      'SKILL_REGISTRY_STORE',
      'SKILL_TASK_GRADE_STORE',
      'SKILL_MD_MIGRATION_STATE_STORE',
      'SKILL_REGISTRY_CATALOG_SERVICE',
      'SKILL_ENHANCER_SERVICE',
      'SPEC_HARVESTER_SERVICE',
      'SUBAGENT_METRICS_EXTRACTOR',
      'SKILL_SCORECARD_SERVICE',
      'NETWORK_BACKOFF',
      'LANE_RESOLVER_SERVICE',
      'LANE_RUNNER_SERVICE',
      'SESSION_VERDICT_STORE',
    ] as const;
    for (const key of retained) {
      expect(container.isRegistered(SKILL_SYNTHESIS_TOKENS[key])).toBe(true);
    }
    expect(
      container.isRegistered(Symbol.for('PtahSkillSynthesisService')),
    ).toBe(false);
    expect(container.isRegistered(Symbol.for('PtahSkillCandidateStore'))).toBe(
      false,
    );
    expect(
      container.isRegistered(Symbol.for('PtahSkillSynthesisBudgetStore')),
    ).toBe(false);
    expect(
      container.isRegistered(Symbol.for('PtahSkillSynthesisQueueStore')),
    ).toBe(false);
  });

  it('gives the retained tokens globally unique descriptions', () => {
    const descriptions = Object.values(SKILL_SYNTHESIS_TOKENS).map(
      (t) => t.description,
    );
    expect(new Set(descriptions).size).toBe(descriptions.length);
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
