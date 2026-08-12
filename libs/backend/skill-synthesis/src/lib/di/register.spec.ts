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
import type { Logger } from '@ptah-extension/vscode-core';
import { registerSkillSynthesisServices } from './register';
import {
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

  it('points the session-activity token at the SDK registry symbol', () => {
    // Same globally-interned symbol as SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY.
    // Declared locally to avoid the circular dependency; a typo here would make
    // the tracker silently resolve nothing and never report activity.
    expect(SESSION_ACTIVITY_REGISTRY_TOKEN).toBe(
      Symbol.for('SdkSessionActivityRegistry'),
    );
  });
});
