/**
 * SkillSynthesizerService specs.
 *
 * Driven through a REAL `LaneRunnerService`, because the two things B1.6.3
 * changed are both properties of the runner boundary: `maxInputChars` now
 * clips the prompt instead of a hardcoded slice, and `outputFormat` now goes
 * out with the request. A stubbed runner could not observe either.
 */
import 'reflect-metadata';
import {
  SkillSynthesizerService,
  SYNTHESIZED_SKILL_JSON_SCHEMA,
} from './skill-synthesizer.service';
import { LaneRunnerService } from './lanes/lane-runner.service';
import {
  assistantText,
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  makeThrowingResolverStub,
  resolvedLane,
  resultMessage,
  type StreamMessage,
} from './lanes/lane-runner.test-support';
import { LANE_TRUNCATION_MARKER } from './lanes/lane-runner.service';
import type { SkillLaneConfig } from './lanes/lane.types';
import type { ExtractedTrajectory } from './trajectory-extractor';
import type { SkillSynthesisSettings } from './types';

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

const SKILL_JSON = {
  name: 'reusable-skill',
  description: 'when X happens',
  body: '## Steps\n1. z',
};

function makeSynthesizer(
  scripts: StreamMessage[][],
  config: Partial<SkillLaneConfig> = {},
) {
  const logger = makeLogger();
  const query = makeQueryStub(scripts);
  const runner = new LaneRunnerService(
    logger,
    makeResolverStub(resolvedLane('synthesis', { config })).service,
    makeBudgetStub().store,
    query.query,
    null,
  );
  return { svc: new SkillSynthesizerService(logger, runner), query, logger };
}

/** A synthesizer in a host that registered no LLM at all. */
function makeHostlessSynthesizer() {
  const logger = makeLogger();
  const runner = new LaneRunnerService(
    logger,
    makeResolverStub(resolvedLane('synthesis')).service,
    makeBudgetStub().store,
    null,
    null,
  );
  return { svc: new SkillSynthesizerService(logger, runner), logger };
}

function makeThrowingSynthesizer() {
  const logger = makeLogger();
  const runner = new LaneRunnerService(
    logger,
    makeThrowingResolverStub(new Error('provider down')),
    makeBudgetStub().store,
    makeQueryStub([[]]).query,
    null,
  );
  return { svc: new SkillSynthesizerService(logger, runner), logger };
}

describe('SkillSynthesizerService', () => {
  it('returns the template fallback when no lane exists in this host', async () => {
    const { svc } = makeHostlessSynthesizer();
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('do-thing');
    expect(out?.description).toBe('do thing');
    expect(out?.body).toContain('## Trajectory (normalized)');
  });

  it('parses a structured answer from the lane', async () => {
    const { svc } = makeSynthesizer([
      [resultMessage({ structured_output: SKILL_JSON })],
    ]);
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('reusable-skill');
    expect(out?.description).toBe('when X happens');
    expect(out?.body).toContain('## Steps');
  });

  it('keeps extractJsonObject alive for an endpoint that answers in prose', async () => {
    // The `structuredOutput: 'parse'` path: no `structured_output` field at
    // all, so the manual balanced-brace extractor is the ONLY way through.
    const { svc } = makeSynthesizer(
      [
        [
          assistantText(`Here you go:\n${JSON.stringify(SKILL_JSON)}`),
          resultMessage(),
        ],
      ],
      { structuredOutput: 'parse' },
    );
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('reusable-skill');
    expect(out?.body).toContain('## Steps');
  });

  it('falls back to the template when neither rung parses', async () => {
    const { svc, query } = makeSynthesizer([
      [assistantText('sorry, no JSON here'), resultMessage()],
      [assistantText('still nothing'), resultMessage()],
    ]);
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('do-thing');
    expect(out?.body).toContain('## Trajectory (normalized)');
    expect(query.execute).toHaveBeenCalledTimes(2);
  });

  it('falls back to the template when the lane call throws', async () => {
    const { svc } = makeThrowingSynthesizer();
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('do-thing');
    expect(out?.body).toContain('## Trajectory (normalized)');
  });

  it('rejects a structured answer that is missing a required field', async () => {
    // Zod stays the authority even when the endpoint honoured the schema.
    const { svc } = makeSynthesizer([
      [resultMessage({ structured_output: { name: 'x', description: 'y' } })],
    ]);
    const out = await svc.synthesize(trajectory(), SETTINGS);
    expect(out?.name).toBe('do-thing');
  });

  describe('lane contract', () => {
    it('sends outputFormat mirroring SynthesizedSkillSchema', async () => {
      const { svc, query } = makeSynthesizer([
        [resultMessage({ structured_output: SKILL_JSON })],
      ]);
      await svc.synthesize(trajectory(), SETTINGS);

      expect(query.calls[0].outputFormat).toEqual({
        type: 'json_schema',
        schema: SYNTHESIZED_SKILL_JSON_SCHEMA,
      });
      expect(SYNTHESIZED_SKILL_JSON_SCHEMA['required']).toEqual([
        'name',
        'description',
        'body',
      ]);
    });

    it('takes maxInputChars from the lane, not from a hardcoded slice', async () => {
      const { svc, query } = makeSynthesizer(
        [[resultMessage({ structured_output: SKILL_JSON })]],
        { maxInputChars: 200 },
      );
      await svc.synthesize(
        trajectory({ canonicalText: 'x'.repeat(20_000) }),
        SETTINGS,
      );

      const prompt = query.calls[0].prompt;
      expect(prompt).toHaveLength(200 + LANE_TRUNCATION_MARKER.length);
      expect(prompt.endsWith(LANE_TRUNCATION_MARKER)).toBe(true);
    });

    it('passes a trajectory under the lane budget through whole', async () => {
      const { svc, query } = makeSynthesizer(
        [[resultMessage({ structured_output: SKILL_JSON })]],
        { maxInputChars: 50_000 },
      );
      await svc.synthesize(
        trajectory({ canonicalText: 'y'.repeat(9_000) }),
        SETTINGS,
      );
      // The old hardcoded `.slice(0, 8000)` would have cut this to 8000.
      expect(query.calls[0].prompt).toContain('y'.repeat(9_000));
    });

    it('keeps the authoring rules out of the clippable prompt', async () => {
      const { svc, query } = makeSynthesizer([
        [resultMessage({ structured_output: SKILL_JSON })],
      ]);
      await svc.synthesize(trajectory(), SETTINGS);
      expect(query.calls[0].systemPromptAppend).toContain(
        'skill-authoring best practices',
      );
      expect(query.calls[0].prompt).not.toContain(
        'skill-authoring best practices',
      );
    });

    it('runs on the synthesis lane', async () => {
      const logger = makeLogger();
      const query = makeQueryStub([
        [resultMessage({ structured_output: SKILL_JSON })],
      ]);
      const resolver = makeResolverStub(resolvedLane('synthesis'));
      const svc = new SkillSynthesizerService(
        logger,
        new LaneRunnerService(
          logger,
          resolver.service,
          makeBudgetStub().store,
          query.query,
          null,
        ),
      );
      await svc.synthesize(trajectory(), SETTINGS);
      expect(resolver.resolve).toHaveBeenCalledWith('synthesis');
    });
  });

  describe('synthesizeFromCluster', () => {
    const members = [
      { description: 'session one', body: '[tool:Edit] one' },
      { description: 'session two', body: '[tool:Edit] two' },
    ];

    it('returns null when no lane exists in this host (no template fallback)', async () => {
      const { svc } = makeHostlessSynthesizer();
      expect(await svc.synthesizeFromCluster(members, SETTINGS)).toBeNull();
    });

    it('returns null for an empty cluster without calling the lane', async () => {
      const { svc, query } = makeSynthesizer([
        [resultMessage({ structured_output: SKILL_JSON })],
      ]);
      expect(await svc.synthesizeFromCluster([], SETTINGS)).toBeNull();
      expect(query.execute).not.toHaveBeenCalled();
    });

    it('parses a skill distilled from the cluster', async () => {
      const { svc } = makeSynthesizer([
        [
          resultMessage({
            structured_output: { ...SKILL_JSON, name: 'common-workflow' },
          }),
        ],
      ]);
      const out = await svc.synthesizeFromCluster(members, SETTINGS);
      expect(out?.name).toBe('common-workflow');
      expect(out?.body).toContain('## Steps');
    });

    it('returns null when the lane produces nothing parseable', async () => {
      const { svc } = makeSynthesizer([
        [assistantText('no json'), resultMessage()],
        [assistantText('no json'), resultMessage()],
      ]);
      expect(await svc.synthesizeFromCluster(members, SETTINGS)).toBeNull();
    });

    it('bounds each member so one huge session cannot crowd out the rest', async () => {
      const { svc, query } = makeSynthesizer(
        [[resultMessage({ structured_output: SKILL_JSON })]],
        { maxInputChars: 100_000 },
      );
      await svc.synthesizeFromCluster(
        [
          { description: 'huge', body: 'a'.repeat(10_000) },
          { description: 'small', body: 'the second member' },
        ],
        SETTINGS,
      );
      const prompt = query.calls[0].prompt;
      expect(prompt).not.toContain('a'.repeat(3_001));
      expect(prompt).toContain('the second member');
    });
  });
});
