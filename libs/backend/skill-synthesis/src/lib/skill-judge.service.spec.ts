/**
 * SkillJudgeService specs.
 *
 * The judge is driven through a REAL `LaneRunnerService` wired to the shared
 * lane stubs rather than through a stubbed runner. The three converted
 * fail-open sites are distinguished by what the ENDPOINT did — honoured the
 * schema and answered nothing usable, answered with values that are not scores,
 * or never answered — and a stubbed runner would let the spec assert those
 * distinctions into existence instead of observing them.
 *
 * P1-1  — a judge that cannot produce a verdict returns `unscored`, never a pass.
 * P1-11 — `score: 10` appears in no judge result, and in no line of the service.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  JUDGE_REASONS,
  SkillJudgeService,
  type JudgeDecision,
} from './skill-judge.service';
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
import type {
  SkillCandidateRow,
  SkillSynthesisSettings,
  CandidateId,
} from './types';
import { unjudgedVerdictFields, unmeasuredGateFields } from './types';

function makeSettings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    maxPinnedSkills: 10,
    curatorEnabled: false,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
    ...overrides,
  };
}

function fakeCandidate(): SkillCandidateRow {
  return {
    id: 'cand_j' as CandidateId,
    name: 'judge-me',
    description: 'test skill',
    bodyPath: '/tmp/SKILL.md',
    sourceSessionIds: [],
    trajectoryHash: 'h',
    embeddingRowid: null,
    status: 'candidate',
    successCount: 3,
    failureCount: 0,
    createdAt: 1,
    promotedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
    residency: 'resident',
    workspaceRoot: null,
    ...unjudgedVerdictFields(),
    ...unmeasuredGateFields(),
  };
}

/** Block and whole-line comments removed, so a source scan sees only code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** All five criteria at the same value — the simplest scorecard to reason about. */
function flatScorecard(value: number): Record<string, number> {
  return {
    novelty: value,
    actionability: value,
    scope: value,
    generalization: value,
    triggerClarity: value,
  };
}

/**
 * A judge behind a real runner. `scripts` is one message list per `execute`
 * call, so a case that expects the runner's re-run rung supplies two.
 */
function makeJudge(scripts: StreamMessage[][]) {
  const logger = makeLogger();
  const query = makeQueryStub(scripts);
  const runner = new LaneRunnerService(
    logger,
    makeResolverStub(resolvedLane('judge')).service,
    makeBudgetStub().store,
    query.query,
    null,
  );
  return { svc: new SkillJudgeService(logger, runner), query, logger };
}

/** A judge whose lane throws outright — the shape a real transport defect has. */
function makeThrowingJudge() {
  const logger = makeLogger();
  const runner = new LaneRunnerService(
    logger,
    makeThrowingResolverStub(new Error('network error')),
    makeBudgetStub().store,
    makeQueryStub([[]]).query,
    null,
  );
  return { svc: new SkillJudgeService(logger, runner), logger };
}

/** A judge in a host that registered no LLM at all. */
function makeHostlessJudge() {
  const logger = makeLogger();
  const runner = new LaneRunnerService(
    logger,
    makeResolverStub(resolvedLane('judge')).service,
    makeBudgetStub().store,
    null,
    null,
  );
  return { svc: new SkillJudgeService(logger, runner), logger };
}

describe('SkillJudgeService', () => {
  describe('scored verdicts', () => {
    it('averages the five criteria from a structured answer', async () => {
      const { svc } = makeJudge([
        [resultMessage({ structured_output: flatScorecard(7) })],
      ]);
      const result = await svc.judge(
        fakeCandidate(),
        'body',
        makeSettings({ minJudgeScore: 6.0 }),
      );
      expect(result.status).toBe('scored');
      expect(result.score).toBeCloseTo(7.0);
      expect(result.reason).toBe(JUDGE_REASONS.verdict);
      expect(result.criteria).toEqual(flatScorecard(7));
    });

    it('reads the scorecard out of prose when the endpoint ignores the schema', async () => {
      const { svc } = makeJudge([
        [
          assistantText(
            'Here you go: {"novelty":3,"actionability":4,"scope":5,"generalization":4,"triggerClarity":4}',
          ),
          resultMessage(),
        ],
      ]);
      const result = await svc.judge(
        fakeCandidate(),
        'body',
        makeSettings({ minJudgeScore: 6.0 }),
      );
      expect(result.status).toBe('scored');
      expect(result.score).toBeCloseTo(4.0);
      expect(result.criteria?.novelty).toBe(3);
    });

    it('does NOT decide pass/fail itself — a low score is still a scored verdict', async () => {
      const { svc } = makeJudge([
        [resultMessage({ structured_output: flatScorecard(2) })],
      ]);
      const result = await svc.judge(
        fakeCandidate(),
        'body',
        makeSettings({ minJudgeScore: 6.0 }),
      );
      // The threshold belongs to the caller; the judge only reports.
      expect(result.status).toBe('scored');
      expect(result.score).toBeCloseTo(2.0);
      expect(result).not.toHaveProperty('passed');
    });
  });

  describe('disabled — a missing gate is not a failed one', () => {
    it('short-circuits when judgeEnabled=false, without calling the LLM', async () => {
      const { svc, query } = makeJudge([
        [resultMessage({ structured_output: flatScorecard(9) })],
      ]);
      const result = await svc.judge(
        fakeCandidate(),
        'body text',
        makeSettings({ judgeEnabled: false }),
      );
      expect(result).toEqual<JudgeDecision>({
        status: 'disabled',
        score: null,
        criteria: null,
        reason: JUDGE_REASONS.disabled,
      });
      expect(query.execute).not.toHaveBeenCalled();
    });

    it('reports disabled — not unscored — in a host with no LLM registered', async () => {
      const { svc } = makeHostlessJudge();
      const result = await svc.judge(
        fakeCandidate(),
        'body text',
        makeSettings(),
      );
      expect(result.status).toBe('disabled');
      expect(result.score).toBeNull();
    });
  });

  describe('the three converted fail-open sites', () => {
    it('site 1 — no usable JSON object: unscored, distinct reason', async () => {
      // The endpoint HONOURED the schema and answered `null`. The runner treats
      // that as resolved (no re-run), so the emptiness lands on the judge.
      const { svc, query } = makeJudge([
        [resultMessage({ structured_output: null })],
      ]);
      const result = await svc.judge(fakeCandidate(), 'body', makeSettings());
      expect(result.status).toBe('unscored');
      expect(result.score).toBeNull();
      expect(result.criteria).toBeNull();
      expect(result.reason).toBe(JUDGE_REASONS.noJson);
      expect(query.execute).toHaveBeenCalledTimes(1);
    });

    it('site 2 — the old 3-criteria shape scores nothing: unscored, distinct reason', async () => {
      const { svc } = makeJudge([
        [
          resultMessage({
            structured_output: { novelty: 8, actionability: 8, scope: 8 },
          }),
        ],
      ]);
      const result = await svc.judge(fakeCandidate(), 'body', makeSettings());
      expect(result.status).toBe('unscored');
      expect(result.score).toBeNull();
      expect(result.reason).toBe(JUDGE_REASONS.invalidScores);
    });

    it('site 2 — an out-of-range score is not a score', async () => {
      const { svc } = makeJudge([
        [
          resultMessage({
            structured_output: { ...flatScorecard(7), novelty: 99 },
          }),
        ],
      ]);
      const result = await svc.judge(fakeCandidate(), 'body', makeSettings());
      expect(result.status).toBe('unscored');
      expect(result.reason).toBe(JUDGE_REASONS.invalidScores);
    });

    it('site 3 — the call throws: unscored, distinct reason', async () => {
      const { svc } = makeThrowingJudge();
      const result = await svc.judge(fakeCandidate(), 'body', makeSettings());
      expect(result.status).toBe('unscored');
      expect(result.score).toBeNull();
      expect(result.reason).toBe(JUDGE_REASONS.callThrew);
    });

    it('gives all three sites DISTINCT reasons', async () => {
      const noJson = await makeJudge([
        [resultMessage({ structured_output: null })],
      ]).svc.judge(fakeCandidate(), 'body', makeSettings());
      const invalid = await makeJudge([
        [resultMessage({ structured_output: { novelty: 8 } })],
      ]).svc.judge(fakeCandidate(), 'body', makeSettings());
      const threw = await makeThrowingJudge().svc.judge(
        fakeCandidate(),
        'body',
        makeSettings(),
      );

      const reasons = [noJson.reason, invalid.reason, threw.reason];
      expect(new Set(reasons).size).toBe(3);
      expect(reasons).toEqual([
        JUDGE_REASONS.noJson,
        JUDGE_REASONS.invalidScores,
        JUDGE_REASONS.callThrew,
      ]);
    });

    it('surfaces a lane failure verbatim rather than inventing a reason', async () => {
      // Unparseable on BOTH rungs of the runner's ladder → the lane itself
      // fails, and its user-facing reason is what reaches the queue row.
      const { svc, query } = makeJudge([
        [assistantText('this is not json at all'), resultMessage()],
        [assistantText('still not json'), resultMessage()],
      ]);
      const result = await svc.judge(fakeCandidate(), 'body', makeSettings());
      expect(result.status).toBe('unscored');
      expect(result.score).toBeNull();
      expect(result.reason).toContain('judge');
      expect(result.reason).not.toBe(JUDGE_REASONS.verdict);
      expect(query.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('P1-11 — no fabricated perfect score, anywhere', () => {
    it('returns score=null on every branch that cannot produce a verdict', async () => {
      const decisions: JudgeDecision[] = [
        await makeJudge([[]]).svc.judge(
          fakeCandidate(),
          'b',
          makeSettings({ judgeEnabled: false }),
        ),
        await makeHostlessJudge().svc.judge(
          fakeCandidate(),
          'b',
          makeSettings(),
        ),
        await makeJudge([
          [resultMessage({ structured_output: null })],
        ]).svc.judge(fakeCandidate(), 'b', makeSettings()),
        await makeJudge([
          [resultMessage({ structured_output: { novelty: 8 } })],
        ]).svc.judge(fakeCandidate(), 'b', makeSettings()),
        await makeThrowingJudge().svc.judge(
          fakeCandidate(),
          'b',
          makeSettings(),
        ),
        await makeJudge([
          [assistantText('nope'), resultMessage()],
          [assistantText('nope again'), resultMessage()],
        ]).svc.judge(fakeCandidate(), 'b', makeSettings()),
      ];

      expect(decisions).toHaveLength(6);
      for (const decision of decisions) {
        expect(decision.status).not.toBe('scored');
        expect(decision.score).toBeNull();
        expect(decision.score).not.toBe(10);
        expect(decision.criteria).toBeNull();
      }
    });

    it('never emits the literal `score: 10`, and owns no timeout constant', () => {
      const source = path.join(__dirname, 'skill-judge.service.ts');
      // Asserted rather than assumed: a moved file would otherwise turn this
      // guard into a test that reads nothing and passes.
      expect(fs.existsSync(source)).toBe(true);
      const code = stripComments(fs.readFileSync(source, 'utf8'));

      // The fail-open literal this phase exists to delete. Comments are
      // stripped first — the header DESCRIBES the old shape on purpose, and a
      // guard that forbade naming the defect would forbid documenting it.
      expect(code).not.toMatch(/score:\s*10\b/);
      expect(code).not.toMatch(/passed:\s*true/);
      // Every timeout is the lane's now.
      expect(code).not.toContain('JUDGE_TIMEOUT_MS');
      expect(code).not.toContain('setTimeout');
    });
  });

  describe('prompt construction', () => {
    it('keeps the rubric OUT of the clippable prompt', async () => {
      const { svc, query } = makeJudge([
        [resultMessage({ structured_output: flatScorecard(7) })],
      ]);
      await svc.judge(fakeCandidate(), 'body text', makeSettings());

      const call = query.calls[0];
      // `maxInputChars` clips `prompt` only, so the criteria and the
      // reply-with-JSON instruction must never live there.
      expect(call.systemPromptAppend).toContain('Score each criterion 1-10');
      expect(call.systemPromptAppend).toContain('triggerClarity');
      expect(call.prompt).not.toContain('Score each criterion 1-10');
      expect(call.prompt).toContain('Skill name: judge-me');
      expect(call.prompt).toContain('body text');
    });

    it('appends optional context as background material', async () => {
      const { svc, query } = makeJudge([
        [resultMessage({ structured_output: flatScorecard(7) })],
      ]);
      await svc.judge(
        fakeCandidate(),
        'body',
        makeSettings(),
        'Measured scorecard for this agent: success 71%',
      );
      const prompt = query.calls[0].prompt;
      expect(prompt).toContain('Background (measured usage signal');
      expect(prompt).toContain(
        'Measured scorecard for this agent: success 71%',
      );
    });

    it('omits the background section when no context is supplied', async () => {
      const { svc, query } = makeJudge([
        [resultMessage({ structured_output: flatScorecard(7) })],
      ]);
      await svc.judge(fakeCandidate(), 'body', makeSettings());
      expect(query.calls[0].prompt).not.toContain(
        'Background (measured usage signal',
      );
    });

    it('context does not change the composite', async () => {
      const { svc } = makeJudge([
        [resultMessage({ structured_output: flatScorecard(7) })],
      ]);
      const result = await svc.judge(
        fakeCandidate(),
        'body',
        makeSettings(),
        'some context',
      );
      expect(result.score).toBeCloseTo(7.0);
    });

    it('still refuses to fail open with context present when the call throws', async () => {
      const { svc } = makeThrowingJudge();
      const result = await svc.judge(
        fakeCandidate(),
        'body',
        makeSettings(),
        'context that must not become a pass',
      );
      expect(result.status).toBe('unscored');
      expect(result.score).toBeNull();
    });
  });
});
