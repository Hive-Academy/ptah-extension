/**
 * P2-2 — the tail regex is a SIGNAL, and the verdict is the AUTHORITY.
 *
 * `SUCCESS_MARKERS` matches a model writing "Task complete!". That is evidence
 * that a model wrote a sentence, and before phase 2 it was the only notion of
 * "this session succeeded" the pipeline had. The archaeologist replaces it with
 * `SessionVerdict.evidenceClass`, judged across the whole transcript.
 *
 * The criterion is deliberately NEGATIVE — "no code path reads
 * `hasSuccessMarker` to decide success" — so this file has to make the forbidden
 * thing reachable before asserting it does not happen. Four independent moves,
 * because any one alone is satisfiable by an implementation that is wrong in a
 * different way:
 *
 *  1. **The flag is still produced.** A demotion that quietly deleted the
 *     computation would pass every "nothing reads it" assertion below while
 *     removing a signal phases 3/4 may want. The extractor is REAL here, over a
 *     transcript whose final assistant turn matches `SUCCESS_MARKERS`.
 *  2. **The verdict for that same transcript is `unverified`.** Asserted through
 *     the real `SessionArchaeologistService`, not by constructing a row by hand:
 *     the claim is that the analyzer's answer and the regex's answer DISAGREE on
 *     the same session, and a hand-built verdict cannot show a disagreement.
 *  3. **Synthesis states the verdict's evidence class and never the flag.** This
 *     is where the demotion has to actually land — the prompt used to carry
 *     `successMarker=<bool>` beside the trajectory, which handed a tail regex to
 *     the model as though it were evidence.
 *  4. **Flipping the flag changes NOTHING about eligibility**, run through the
 *     real `SkillSynthesisService`, plus a source scan over every production file
 *     in the library. The behavioural half catches a decision that reads the flag
 *     indirectly; the scan catches one added tomorrow in a path no spec drives.
 *
 * No SQLite anywhere in this file, on purpose. `better-sqlite3` here is built
 * against Electron's ABI and the house native-gate makes a spec SKIP SILENTLY —
 * green while asserting nothing. The verdict STORE has its own specs; what is
 * under test here is which value flows where, so the store is a spy.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { TrajectoryExtractor } from '../trajectory-extractor';
import { SkillSynthesizerService } from '../skill-synthesizer.service';
import { SkillSynthesisService } from '../skill-synthesis.service';
import type { SkillCandidateStore } from '../skill-candidate.store';
import type { SkillMdGenerator } from '../skill-md-generator';
import type { SkillPromotionService } from '../skill-promotion.service';
import type { ExtractedTrajectory } from '../trajectory-extractor';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import {
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  resolvedLane,
  resultMessage,
} from '../lanes/lane-runner.test-support';
import type {
  LaneRunRequest,
  LaneRunResult,
} from '../lanes/lane-runner.service';
import { SessionArchaeologistService } from './session-archaeologist.service';
import type { SessionVerdictStore } from './session-verdict.store';
import type { SessionVerdict } from './session-verdict.types';
import type { TranscriptJsonlReader } from './transcript-window.reader';

// ── The one transcript this whole file is about ─────────────────────────────

const userTurn = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: text },
});
const assistantTurn = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

/**
 * Six role turns whose LAST assistant turn matches `SUCCESS_MARKERS` twice over
 * ("Task complete" and "All tests pass") — and in which nothing whatsoever
 * demonstrates that anything worked. This is the exact session the regex gets
 * wrong.
 */
const CONFIDENT_TAIL_TRANSCRIPT: unknown[] = [
  userTurn('the deploy script fails on windows'),
  assistantTurn('let me look at the path handling'),
  userTurn('still failing'),
  assistantTurn('trying a different quoting strategy'),
  userTurn('ok'),
  assistantTurn('Task complete! All tests pass.'),
];

function makeJsonlReader(messages: unknown[]): TranscriptJsonlReader & {
  findSessionsDirectory: jest.Mock;
  readJsonlMessages: jest.Mock;
} {
  return {
    findSessionsDirectory: jest.fn(async () => '/sessions'),
    readJsonlMessages: jest.fn(async () => messages),
  };
}

function makeWorkspace(
  settings: Record<string, unknown> = {},
): IWorkspaceProvider {
  return {
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      key in settings ? (settings[key] as T) : (fallback as T),
  } as unknown as IWorkspaceProvider;
}

// ── 1. The flag is still produced ───────────────────────────────────────────

describe('P2-2 — SUCCESS_MARKERS still fires; it just no longer decides', () => {
  it('flags the confident tail as a success marker', async () => {
    const extractor = new TrajectoryExtractor(
      makeLogger() as never,
      makeJsonlReader(CONFIDENT_TAIL_TRANSCRIPT) as never,
    );

    const out = await extractor.extract('s1', '/ws');

    expect(out).not.toBeNull();
    expect(out?.hasSuccessMarker).toBe(true);
    // The demotion must not have been implemented by deleting the computation:
    // a phase-3 feature vector may still want it, and "always false" is a
    // different bug that passes every assertion below.
    expect(out?.turnCount).toBe(6);
  });
});

/**
 * The other half of B2.4.1: `minTurns` was `void`-ed, so every caller was
 * setting a threshold that did nothing while an internal floor silently
 * decided. It is honoured now — and its DEFAULT moved down to that floor, so
 * honouring it did not quietly narrow the harvest phase 2 is widening. Both
 * halves need pinning: restoring the parameter with its old default would pass
 * the first assertion here and fail the second.
 */
describe('B2.4.1 — the extractor honours minTurns without narrowing', () => {
  const FOUR_TURNS = CONFIDENT_TAIL_TRANSCRIPT.slice(0, 4);

  function makeExtractor(messages: unknown[]): TrajectoryExtractor {
    return new TrajectoryExtractor(
      makeLogger() as never,
      makeJsonlReader(messages) as never,
    );
  }

  it('returns null when the caller asks for more turns than the session has', async () => {
    expect(await makeExtractor(FOUR_TURNS).extract('s1', '/ws', 5)).toBeNull();
  });

  it('extracts that SAME session at the default, which is the floor', async () => {
    // If the default were still MIN_TURNS_FOR_TRAJECTORY, honouring the
    // parameter would silently drop every 2–4 turn session from the pipeline.
    const out = await makeExtractor(FOUR_TURNS).extract('s1', '/ws');
    expect(out).not.toBeNull();
    expect(out?.turnCount).toBe(4);
  });

  it('clamps a caller asking for fewer turns than the floor', async () => {
    const out = await makeExtractor(FOUR_TURNS.slice(0, 1)).extract(
      's1',
      '/ws',
      0,
    );
    expect(out).toBeNull();
  });
});

// ── 2. The analyzer disagrees with the regex, on the same session ───────────

/** The archaeologist's reply for that transcript: it settles nothing. */
const UNVERIFIED_REPLY = {
  intent: 'Make the deploy script work on Windows',
  outcome:
    'A different quoting strategy was tried; nothing in the transcript shows it working',
  evidenceClass: 'unverified',
  frictionMap: [
    { turnIndex: 3, kind: 'retry', note: 'second attempt at the same fix' },
  ],
  routine: {
    summary:
      'Quote paths defensively when a shell script fails only on Windows',
    steps: [
      'reproduce on the failing platform',
      'quote every interpolated path',
    ],
    citations: [1, 3],
  },
};

function okRun(json: unknown): LaneRunResult {
  return {
    status: 'ok',
    run: {
      lane: resolvedLane('archaeologist'),
      text: JSON.stringify(json),
      json,
      structuredOutputHonoured: true,
      usage: {},
      truncated: false,
      degradedReason: null,
      executions: 1,
      passesAllowed: 4,
    },
  };
}

/**
 * A verdict store spy. It records what the analyzer wrote and hands it straight
 * back, which is all this file needs — the SQL contract (integer turn indices,
 * non-empty citations, the `0034` CHECK) is pinned by the store's own specs
 * against a real database.
 */
function makeVerdictStoreSpy(): {
  store: SessionVerdictStore;
  save: jest.Mock;
  recordDegraded: jest.Mock;
} {
  const save = jest.fn(
    (input: Record<string, unknown>): SessionVerdict =>
      ({
        sessionId: '',
        workspaceRoot: '',
        intent: null,
        outcome: null,
        evidenceClass: null,
        frictionMap: [],
        routine: null,
        turnCount: 0,
        lane: null,
        model: null,
        passes: 0,
        degradedReason: null,
        createdAt: 1,
        updatedAt: 1,
        ...input,
      }) as SessionVerdict,
  );
  const recordDegraded = jest.fn(
    (sessionId: string, reason: string): SessionVerdict =>
      save({ sessionId, degradedReason: reason }),
  );
  return {
    save,
    recordDegraded,
    store: { save, recordDegraded } as unknown as SessionVerdictStore,
  };
}

async function analyzeConfidentTail(): Promise<SessionVerdict> {
  const verdicts = makeVerdictStoreSpy();
  const run = jest.fn(async (_req: LaneRunRequest) => okRun(UNVERIFIED_REPLY));
  const svc = new SessionArchaeologistService(
    makeLogger() as never,
    makeWorkspace(),
    makeJsonlReader(CONFIDENT_TAIL_TRANSCRIPT) as never,
    { run } as never,
    verdicts.store,
  );

  const result = await svc.analyze({ sessionId: 's1', workspaceRoot: '/ws' });
  if (result.status !== 'ok') {
    throw new Error(`expected an ok verdict, got ${result.status}`);
  }
  return result.verdict;
}

describe('P2-2 — the archaeologist returns unverified for the same session', () => {
  it('writes evidenceClass "unverified" where the regex said success', async () => {
    const verdict = await analyzeConfidentTail();

    expect(verdict.evidenceClass).toBe('unverified');
    // A degraded row would make the verdict unusable and silently send the
    // whole file down the fallback path, which would prove nothing.
    expect(verdict.degradedReason).toBeNull();
    expect(verdict.intent).toBe('Make the deploy script work on Windows');
  });
});

// ── 3. Synthesis reads the verdict, never the flag ──────────────────────────

const SKILL_JSON = {
  name: 'quote-paths-on-windows',
  description: 'Use when a shell script fails only on Windows',
  body: '## Steps\n1. reproduce',
};

function makeSynthesizer() {
  const logger = makeLogger();
  const query = makeQueryStub([
    [resultMessage({ structured_output: SKILL_JSON })],
  ]);
  const runner = new LaneRunnerService(
    logger,
    makeResolverStub(
      resolvedLane('synthesis', { config: { maxInputChars: 100_000 } }),
    ).service,
    makeBudgetStub().store,
    query.query,
    null,
  );
  return { svc: new SkillSynthesizerService(logger, runner), query };
}

describe('P2-2 — the synthesis prompt is built from the verdict', () => {
  it('states the verdict evidence class and never the tail-regex flag', async () => {
    const verdict = await analyzeConfidentTail();
    const extractor = new TrajectoryExtractor(
      makeLogger() as never,
      makeJsonlReader(CONFIDENT_TAIL_TRANSCRIPT) as never,
    );
    const trajectory = await extractor.extract('s1', '/ws');
    if (!trajectory) throw new Error('fixture produced no trajectory');
    // The precondition for this whole assertion: the regex says success.
    expect(trajectory.hasSuccessMarker).toBe(true);

    const { svc, query } = makeSynthesizer();
    await svc.synthesize(trajectory, {} as never, verdict);

    const prompt = query.calls[0].prompt;
    // The VERDICT is what the model is told, and it is told plainly.
    expect(prompt).toContain('unverified');
    expect(prompt).toContain('Make the deploy script work on Windows');
    expect(prompt).toContain('Do not write the skill as if it succeeded');
    // …and the regex verdict is nowhere in it. `successMarker=true` was the
    // literal token this prompt used to carry.
    expect(prompt).not.toContain('successMarker');
    expect(prompt).not.toContain('Task complete');
  });

  it('carries the routine turn citations rather than the raw transcript', async () => {
    const verdict = await analyzeConfidentTail();
    const trajectory = await new TrajectoryExtractor(
      makeLogger() as never,
      makeJsonlReader(CONFIDENT_TAIL_TRANSCRIPT) as never,
    ).extract('s1', '/ws');
    if (!trajectory) throw new Error('fixture produced no trajectory');

    const { svc, query } = makeSynthesizer();
    await svc.synthesize(trajectory, {} as never, verdict);

    const prompt = query.calls[0].prompt;
    expect(prompt).toContain('turns 1, 3');
    expect(prompt).toContain('[turn 3] retry');
    // `canonicalText` still exists and is still the embedding/dedup text — it
    // is simply not what the model is asked to read any more.
    expect(prompt).not.toContain(trajectory.canonicalText);
  });

  it('FALLS BACK to the trajectory when the verdict is degraded', async () => {
    // The negative control for the two assertions above: without it, "the
    // prompt contains the verdict" would also hold for an implementation that
    // ignored the fallback contract and left hosts with no analysis lane
    // unable to synthesize at all.
    const trajectory = await new TrajectoryExtractor(
      makeLogger() as never,
      makeJsonlReader(CONFIDENT_TAIL_TRANSCRIPT) as never,
    ).extract('s1', '/ws');
    if (!trajectory) throw new Error('fixture produced no trajectory');
    const degraded = {
      ...(await analyzeConfidentTail()),
      degradedReason: 'no-query-path',
    };

    const { svc, query } = makeSynthesizer();
    await svc.synthesize(trajectory, {} as never, degraded);

    const prompt = query.calls[0].prompt;
    expect(prompt).toContain(trajectory.canonicalText);
    // Even on the fallback path the tail regex does not travel.
    expect(prompt).not.toContain('successMarker');
  });
});

// ── 4. Nothing decides on the flag ──────────────────────────────────────────

function trajectoryFixture(
  overrides: Partial<ExtractedTrajectory> = {},
): ExtractedTrajectory {
  return {
    hash: 'h',
    canonicalText: 'canon',
    turnCount: 6,
    sessionTurnCount: 6,
    shortDescription: 'do thing',
    slug: 'do-thing',
    editCount: 2,
    toolUseCount: 4,
    bashTestPassed: false,
    charLength: 900,
    hasSuccessMarker: false,
    ...overrides,
  };
}

/** A `SkillSynthesisService` whose collaborators all reach a real decision. */
function makeSynthesisService() {
  const store = {
    findByTrajectoryHash: jest.fn(() => null),
    registerCandidate: jest.fn(() => ({
      candidate: { id: 'cand-1' },
      reused: false,
    })),
    recordInvocation: jest.fn(),
    getDominantSkillSlugForSessions: jest.fn(() => null),
  } as unknown as jest.Mocked<SkillCandidateStore>;
  const md = {
    candidatesRoot: jest.fn(() => '/tmp/cands'),
    writeCandidate: jest.fn(() => ({
      slug: 'do-thing',
      dir: '/tmp/cands/do-thing',
      filePath: '/tmp/cands/do-thing/SKILL.md',
    })),
  } as unknown as jest.Mocked<SkillMdGenerator>;
  const extractor = {
    extract: jest.fn().mockResolvedValue(trajectoryFixture()),
  } as unknown as jest.Mocked<TrajectoryExtractor>;

  const svc = new SkillSynthesisService(
    makeLogger() as never,
    {
      isOpen: true,
      openAndMigrate: jest.fn().mockResolvedValue(undefined),
    } as never,
    { available: false } as never,
    makeWorkspace(),
    store,
    md,
    { evaluate: jest.fn() } as unknown as jest.Mocked<SkillPromotionService>,
    extractor,
    null,
    { register: jest.fn(() => jest.fn()) } as never,
  );
  return { svc, store, extractor };
}

describe('P2-2 — no eligibility decision reads hasSuccessMarker', () => {
  /**
   * The behavioural half. Run the SAME trajectory twice, differing only in the
   * flag, through the real service — including a shape the prefilter REJECTS,
   * because a gate that reads the flag would most plausibly read it as a
   * tie-breaker on the rejection path.
   */
  it.each([
    ['an accepted session', trajectoryFixture(), true],
    [
      'a rejected session',
      trajectoryFixture({
        editCount: 0,
        toolUseCount: 0,
        turnCount: 2,
        charLength: 10,
        bashTestPassed: false,
      }),
      false,
    ],
  ])(
    'decides %s identically with and without the marker',
    async (_label, shape, expectedAccept) => {
      const outcomes: boolean[] = [];
      for (const hasSuccessMarker of [true, false]) {
        const { svc, extractor } = makeSynthesisService();
        await svc.start();
        (extractor.extract as jest.Mock).mockResolvedValue({
          ...(shape as ExtractedTrajectory),
          hasSuccessMarker,
        });
        const result = await svc.analyzeSession(
          `s-${hasSuccessMarker}`,
          '/repo',
        );
        outcomes.push(result !== null);
      }
      expect(outcomes[0]).toBe(outcomes[1]);
      expect(outcomes[0]).toBe(expectedAccept);
    },
  );

  /**
   * The source half. The behavioural test above only covers the paths it drives;
   * this covers every path in the library, including ones added later.
   */
  it('is read by no production file except the extractor that produces it', () => {
    const root = path.join(__dirname, '..', '..');
    const offenders: string[] = [];
    for (const file of productionFiles(root)) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('hasSuccessMarker')) continue;
      if (path.basename(file) === 'trajectory-extractor.ts') continue;
      offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
  });

  it('no production file carries the old successMarker prompt token', () => {
    const root = path.join(__dirname, '..', '..');
    const offenders = productionFiles(root).filter((file) =>
      fs.readFileSync(file, 'utf8').includes('successMarker='),
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});

/** Every shipped `.ts` under the library — no specs, no test support. */
function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...productionFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts')) continue;
    if (entry.name.endsWith('.test-support.ts')) continue;
    out.push(full);
  }
  return out;
}
