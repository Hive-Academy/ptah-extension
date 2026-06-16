import 'reflect-metadata';
import { SkillSynthesizerService } from './skill-synthesizer.service';
import type { ExtractedTrajectory } from './trajectory-extractor';
import type { SkillSynthesisSettings } from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillSynthesizerService>[0];

const workspaceProvider = {
  getConfiguration: jest.fn((_s: string, _k: string, fb: unknown) => fb),
} as unknown as ConstructorParameters<typeof SkillSynthesizerService>[1];

const SETTINGS = {
  judgeModel: 'inherit',
} as unknown as SkillSynthesisSettings;

function trajectory(
  overrides: Partial<ExtractedTrajectory> = {},
): ExtractedTrajectory {
  return {
    hash: 'h',
    canonicalText: '[user] do thing\n---\n[assistant] [tool:Edit]',
    turnCount: 2,
    sessionTurnCount: 2,
    shortDescription: 'do thing',
    slug: 'do-thing',
    editCount: 1,
    toolUseCount: 1,
    bashTestPassed: false,
    charLength: 40,
    hasSuccessMarker: false,
    ...overrides,
  };
}

function streamFrom(text: string) {
  return {
    execute: jest.fn().mockResolvedValue({
      stream: (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text }] },
        };
        yield { type: 'result' };
      })(),
      abort: jest.fn(),
      close: jest.fn(),
    }),
  };
}

describe('SkillSynthesizerService', () => {
  it('returns the template fallback when internalQuery is null', async () => {
    const svc = new SkillSynthesizerService(
      noopLogger,
      workspaceProvider,
      null,
    );
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out).not.toBeNull();
    expect(out?.name).toBe('do-thing');
    expect(out?.description).toBe('do thing');
    expect(out?.body).toContain('## Trajectory (normalized)');
  });

  it('parses a valid JSON object from the LLM stream', async () => {
    const json = JSON.stringify({
      name: 'reusable-skill',
      description: 'when X happens',
      body: '## Description\nx\n## When to use\n- y\n## Steps\n1. z',
    });
    const iq = streamFrom(`Here you go:\n${json}`);
    const svc = new SkillSynthesizerService(
      noopLogger,
      workspaceProvider,
      iq as never,
    );
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('reusable-skill');
    expect(out?.description).toBe('when X happens');
    expect(out?.body).toContain('## Steps');
  });

  it('falls back to the template when the LLM output is not parseable', async () => {
    const iq = streamFrom('sorry, no JSON here');
    const svc = new SkillSynthesizerService(
      noopLogger,
      workspaceProvider,
      iq as never,
    );
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('do-thing');
    expect(out?.body).toContain('## Trajectory (normalized)');
  });

  it('falls back to the template when the LLM call throws', async () => {
    const iq = {
      execute: jest.fn().mockRejectedValue(new Error('provider down')),
    };
    const svc = new SkillSynthesizerService(
      noopLogger,
      workspaceProvider,
      iq as never,
    );
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('do-thing');
    expect(out?.body).toContain('## Trajectory (normalized)');
  });
});
