/**
 * `mem.update`, `mem.temporal` and `mem.update.seed` (benchmark-design.md
 * 3.3; ledger rows `benchmark-design.md:94`, `:95`). Host suites: they run in
 * the bench host against its isolated DB.
 *
 * ## Sessions
 *
 * Each ground-truth value is planted in its own deterministic session (built
 * here, see {@link updateSessions} and {@link temporalSession}), curated in
 * date order through the curator's windows, the `extract` double, its
 * collector, the `resolve` double and its commit rule (`merge-update-pass.ts`).
 * The bait value v' of an update case is planted once, in the v1 session, as a
 * hypothesis the session rejects. The flattened transcript carries no date,
 * as the product's transcript does not (`ROLE: content` records); the dates
 * live on the session records, which only the raw-grep baseline reads.
 *
 * ## Clock (validation note)
 *
 * `created_at` is not injectable: `MemoryStore.insertMemoryWithChunks` stamps
 * `Date.now()` (`memory.store.ts:199`, `:228`, chunk `:293`) and `MemoryInsert`
 * has no time field (`memory.types.ts`). The suites therefore measure what the
 * product stores: `created_at` is the curation time, never the session date.
 * Curation runs in date order, so recency order still follows the dates.
 *
 * ## Matching
 *
 * Update and temporal cases carry values, not key tokens
 * (`label-schemas.ts:96-159`). A value is present in a hit when the R-M4
 * matcher finds the whole normalised value in the hit's subject and chunk
 * (`matchesFact` with the value as its only key token). A paraphrased value
 * therefore counts as absent; the report asks for key tokens at the freeze.
 *
 * ## Outcomes
 *
 * `mem.update`: per case the question runs through `searchRich` top-10 (the
 * headline) and `buildBlock` (what the agent sees), and is classified by
 * `classifyUpdate` (correct / stale / omission / hallucination). Baselines:
 * latest-chunk-wins over the same top-10 chunks, raw transcript grep (newest
 * session line naming the slot), no memory. The ledger asks correct to beat
 * latest-chunk-wins by MinE 10 points; the numbers and deltas are reported,
 * but the verdict is always `na` (`MIRRORED_COMMIT_NA`): the commit step is a
 * mirror of the curator's private loop, not the product path.
 *
 * `mem.temporal`: all temporal sessions share one scope. Accuracy = the dated
 * answer is in the top-10; date visibility = share of `buildBlock` lines that
 * show an ISO date. Baselines: raw grep of the session records dated on the
 * case date (they carry timestamps), no memory. The ledger asks accuracy to
 * beat raw grep by MinE 10 points; reported, verdict always `na` for the same
 * reason. Expected today: date visibility 0 (forensics M6).
 *
 * `mem.update.seed` (`update-seed.suite.ts`): the setup-wizard path (`MemoryWriterAdapter.upsert`,
 * `memory-writer.adapter.ts:53-100`) seeds v1, then reseeds v2 under the same
 * subject and fingerprint. Invariant: only v2 is retrievable, on every case.
 * Baselines: append-only seed, no memory. Model-free.
 */

import { z } from 'zod';

import { latestChunkWins } from '../../baselines/write-side-baselines';
import {
  temporalCaseSchema,
  updateCaseSchema,
  type TemporalCase,
  type UpdateCase,
} from '../../ground-truth/label-schemas';
import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import {
  classifyUpdate,
  rate,
  updateOutcomeRate,
  type UpdateOutcome,
} from '../../metrics/curation-metrics';
import { writeSuiteResult, type CaseRecord } from '../../runner/suite-result';
import {
  caseScope,
  deltaOf,
  MIRRORED_COMMIT_NA,
  ModelCallLog,
  naReasonOf,
  rateMetrics,
  readGroundTruth,
  recordCase,
  sha256Of,
  type CaseStatus,
} from './merge-update-pass';
import { createSeedSuite } from './update-seed.suite';
import {
  blockLines,
  curateSession,
  GROUND_TRUTH,
  hasValue,
  hitRow,
  NO_MEMORY,
  outcomeMetrics,
  presenceIn,
  READ_TOP_K,
  UPDATE_OUTCOMES,
  type SeededSession,
  type UpdatePresence,
  type UpdateSuiteDeps,
} from './update-reading';

export {
  transcriptOf,
  type SeededSession,
  type UpdateSuiteDeps,
} from './update-reading';
export { SEED_SUITE_ID } from './update-seed.suite';

export const UPDATE_SUITE_ID = 'mem.update';
export const TEMPORAL_SUITE_ID = 'mem.temporal';

/** Design 3.3: ≥ 25 update cases, ≥ 15 temporal cases. */
export const MIN_UPDATE_CASES = 25;
export const MIN_TEMPORAL_CASES = 15;

/** An ISO date, also inside a timestamp (`2026-08-01T00:00:00Z`). */
const ISO_DATE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/u;

const updateOptionsSchema = z.strictObject({
  /** Update cases JSONL, home-relative (seeded as a `file` fixture). */
  updateCases: z.string().min(1),
  cassetteVersion: z.string().min(1).nullable().default(null),
});

const temporalOptionsSchema = z.strictObject({
  /** Temporal cases JSONL, home-relative (seeded as a `file` fixture). */
  temporalCases: z.string().min(1),
  cassetteVersion: z.string().min(1).nullable().default(null),
});

/** v1 (with the rejected bait) and v2 of one update case. */
export function updateSessions(
  updateCase: UpdateCase,
): readonly [SeededSession, SeededSession] {
  const { slot } = updateCase;
  return [
    {
      sessionId: `${updateCase.id}-v1`,
      date: updateCase.v1.at,
      records: [
        { role: 'user', text: `We need to settle ${slot}.` },
        { role: 'user', text: `Could ${slot} be ${updateCase.bait}?` },
        {
          role: 'assistant',
          text: 'I checked that idea and it is wrong; that hypothesis is rejected.',
        },
        { role: 'user', text: `Decision for ${slot}: ${updateCase.v1.value}` },
        { role: 'assistant', text: 'Recorded.' },
      ],
    },
    {
      sessionId: `${updateCase.id}-v2`,
      date: updateCase.v2.at,
      records: [
        {
          role: 'user',
          text: `Update for ${slot}: ${updateCase.v2.value}. This replaces the earlier decision.`,
        },
        { role: 'assistant', text: 'Recorded the update.' },
      ],
    },
  ];
}

/** The one session that states a temporal case's dated answer. */
export function temporalSession(temporalCase: TemporalCase): SeededSession {
  return {
    sessionId: temporalCase.id,
    date: temporalCase.date,
    records: [
      { role: 'user', text: `For the record: ${temporalCase.expectedAnswer}` },
      { role: 'assistant', text: 'Recorded.' },
    ],
  };
}

/** Raw transcript grep: the newest record naming the slot wins. */
function rawGrepPresence(updateCase: UpdateCase): UpdatePresence {
  const slot = updateCase.slot;
  const lines = updateSessions(updateCase)
    .flatMap((session) => session.records.map((record) => record.text))
    .filter((text) => hasValue(slot, { chunk: text }));
  const newest = lines[lines.length - 1];
  return presenceIn(
    updateCase,
    newest === undefined ? [] : [{ chunk: newest }],
  );
}

interface UpdateCaseOutcome {
  readonly read: UpdatePresence;
  readonly block: UpdatePresence;
  readonly latest: UpdatePresence;
  readonly sessions: string;
}

async function runUpdate(
  context: MemorySkillsHostSuiteContext,
  deps: UpdateSuiteDeps,
): Promise<void> {
  const options = updateOptionsSchema.parse(context.options ?? {});
  const cases = readGroundTruth(
    context.isolation.home,
    options.updateCases,
    updateCaseSchema,
  );
  const ports = deps.resolvePorts(context);
  const now = deps.now ?? (() => performance.now());
  const log = new ModelCallLog(now);

  const records: CaseRecord[] = [];
  const statuses: CaseStatus[] = [];
  const done: { updateCase: UpdateCase; outcome: UpdateCaseOutcome }[] = [];
  for (const updateCase of cases) {
    const grep = rawGrepPresence(updateCase);
    const recorded = await recordCase<UpdateCaseOutcome>(
      updateCase.id,
      { case: updateCase, sessions: updateSessions(updateCase) },
      'correct',
      async (signal, attempt) => {
        const workspaceRoot = caseScope(
          context.workspaceRoot,
          UPDATE_SUITE_ID,
          updateCase.id,
          attempt,
        );
        const curated: string[] = [];
        for (const session of updateSessions(updateCase)) {
          const result = await curateSession(
            ports,
            session,
            workspaceRoot,
            log,
            signal,
          );
          curated.push(`${result.status}:${result.drafts}`);
        }
        const { hits } = await ports.searchRich(
          updateCase.question,
          READ_TOP_K,
          workspaceRoot,
        );
        const block = await ports.buildBlock(
          updateCase.question,
          workspaceRoot,
        );
        const slotted = hits.map((hit) => ({
          row: hit,
          matchesSlot: [
            updateCase.v1.value,
            updateCase.v2.value,
            updateCase.bait,
          ].some((value) => hasValue(value, hitRow(hit))),
          createdAt: new Date(hit.chunkCreatedAt).toISOString(),
        }));
        const winner = latestChunkWins(slotted);
        return {
          read: presenceIn(updateCase, hits.map(hitRow)),
          block: presenceIn(
            updateCase,
            blockLines(block).map((line) => ({ chunk: line })),
          ),
          latest: presenceIn(
            updateCase,
            winner === null ? [] : [hitRow(winner)],
          ),
          sessions: curated.join(','),
        };
      },
      (outcome) => {
        const read = classifyUpdate(outcome.read);
        const passIfCorrect = (presence: UpdatePresence): 'pass' | 'fail' =>
          classifyUpdate(presence) === 'correct' ? 'pass' : 'fail';
        return {
          expected: 'correct',
          observed: `searchRich=${read}; buildBlock=${classifyUpdate(outcome.block)}; sessions=${outcome.sessions}`,
          outcome: read === 'correct' ? 'pass' : 'fail',
          baselineOutcomes: {
            'latest-chunk-wins': passIfCorrect(outcome.latest),
            'raw-grep': passIfCorrect(grep),
            'no-memory': passIfCorrect(NO_MEMORY),
          },
        };
      },
      { now, capMs: deps.capMs },
    );
    records.push(recorded.record);
    statuses.push(recorded.status);
    if (recorded.value !== null)
      done.push({ updateCase, outcome: recorded.value });
  }

  const product = {
    ...outcomeMetrics(
      '',
      done.map(({ outcome }) => outcome.read),
    ),
    ...outcomeMetrics(
      'buildBlock.',
      done.map(({ outcome }) => outcome.block),
    ),
  };
  const baselines = [
    {
      id: 'latest-chunk-wins',
      label: 'Latest chunk wins (over the same top-10)',
      metrics: outcomeMetrics(
        '',
        done.map(({ outcome }) => outcome.latest),
      ),
    },
    {
      id: 'raw-grep',
      label: 'Raw transcript grep (newest line naming the slot)',
      metrics: outcomeMetrics('', cases.map(rawGrepPresence)),
    },
    {
      id: 'no-memory',
      label: 'No memory',
      metrics: outcomeMetrics(
        '',
        cases.map(() => NO_MEMORY),
      ),
    },
  ];
  const naReason =
    naReasonOf(statuses, cases.length < MIN_UPDATE_CASES) ?? MIRRORED_COMMIT_NA;
  const correct = updateOutcomeRate(
    done.map(({ outcome }) => outcome.read),
    'correct',
  );
  const value = (outcome: UpdateOutcome): number | null => product[outcome];

  writeSuiteResult(
    context.runDir,
    {
      suiteId: UPDATE_SUITE_ID,
      kind: 'curation',
      arm: 'memory',
      details: {
        operation: 'update',
        cases: done.length,
        correct: correct.value,
        stale: value('stale'),
        omission: value('omission'),
        hallucination: value('hallucination'),
        readPath: 'searchRich',
      },
      claim: {
        source: 'ledger',
        ref: '.ptah/specs/TASK_2026_620_a13e/benchmark-design.md:94',
        text: 'Memory is up to date',
      },
      groundTruth: GROUND_TRUTH,
      baselines,
      deltas: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          deltaOf(product, baseline.metrics, UPDATE_OUTCOMES),
        ]),
      ),
      cost: log.cost(),
      modelCalls: log.calls,
      // Always na: the commit step is a mirror of private product code.
      verdict: 'na',
      naReason,
      metrics: product,
      cassetteVersion: log.calls === 0 ? null : options.cassetteVersion,
    },
    records,
  );
}

/** Session records dated on `date`, rendered with their timestamp, newest first. */
function grepByDate(
  sessions: readonly SeededSession[],
  date: string,
): string[] {
  return sessions
    .filter((session) => session.date === date)
    .flatMap((session) =>
      session.records.map(
        (record) => `${session.date}T00:00:00.000Z ${record.text}`,
      ),
    )
    .reverse()
    .slice(0, READ_TOP_K);
}

interface TemporalOutcome {
  readonly accurate: boolean;
  readonly blockLines: number;
  readonly datedBlockLines: number;
}

async function runTemporal(
  context: MemorySkillsHostSuiteContext,
  deps: UpdateSuiteDeps,
): Promise<void> {
  const options = temporalOptionsSchema.parse(context.options ?? {});
  const cases = readGroundTruth(
    context.isolation.home,
    options.temporalCases,
    temporalCaseSchema,
  );
  const ports = deps.resolvePorts(context);
  const now = deps.now ?? (() => performance.now());
  const log = new ModelCallLog(now);
  const sessions = cases.map(temporalSession);
  const workspaceRoot = caseScope(
    context.workspaceRoot,
    TEMPORAL_SUITE_ID,
    'corpus',
    1,
  );

  // Curate every session first, in date order, into one shared scope; a
  // question whose session did not curate inherits that session's failure.
  const sessionFailure = new Map<string, CaseRecord>();
  const ordered = [...sessions].sort((a, b) =>
    a.date === b.date
      ? a.sessionId < b.sessionId
        ? -1
        : 1
      : a.date < b.date
        ? -1
        : 1,
  );
  for (const session of ordered) {
    const curated = await recordCase(
      session.sessionId,
      session,
      'curated',
      (signal) => curateSession(ports, session, workspaceRoot, log, signal),
      () => ({ expected: 'curated', observed: 'curated', outcome: 'pass' }),
      { now, capMs: deps.capMs },
    );
    if (curated.status !== 'completed') {
      sessionFailure.set(session.sessionId, curated.record);
    }
  }

  const records: CaseRecord[] = [];
  const statuses: CaseStatus[] = [];
  const done: TemporalOutcome[] = [];
  for (const temporalCase of cases) {
    const expected = 'dated-answer-in-top-10';
    const failure = sessionFailure.get(temporalCase.id);
    if (failure !== undefined) {
      records.push({
        ...failure,
        caseId: temporalCase.id,
        inputSha256: sha256Of(temporalCase),
        expected,
      });
      statuses.push(
        failure.observed === 'cassette-miss' ? 'cassette-miss' : 'error',
      );
      continue;
    }
    const recorded = await recordCase<TemporalOutcome>(
      temporalCase.id,
      temporalCase,
      expected,
      async () => {
        const { hits } = await ports.searchRich(
          temporalCase.question,
          READ_TOP_K,
          workspaceRoot,
        );
        const lines = blockLines(
          await ports.buildBlock(temporalCase.question, workspaceRoot),
        );
        return {
          accurate: hits.some((hit) =>
            hasValue(temporalCase.expectedAnswer, hitRow(hit)),
          ),
          blockLines: lines.length,
          datedBlockLines: lines.filter((line) => ISO_DATE.test(line)).length,
        };
      },
      (outcome) => {
        const grep = grepByDate(sessions, temporalCase.date);
        return {
          expected,
          observed: `accurate=${outcome.accurate ? 'yes' : 'no'}; dated-lines=${outcome.datedBlockLines}/${outcome.blockLines}`,
          outcome: outcome.accurate ? 'pass' : 'fail',
          baselineOutcomes: {
            'raw-grep': grep.some((line) =>
              hasValue(temporalCase.expectedAnswer, { chunk: line }),
            )
              ? 'pass'
              : 'fail',
            'no-memory': 'fail',
          },
        };
      },
      { now, capMs: deps.capMs },
    );
    records.push(recorded.record);
    statuses.push(recorded.status);
    if (recorded.value !== null) done.push(recorded.value);
  }

  const accuracy = rate(done.filter((o) => o.accurate).length, done.length);
  const dateVisible = rate(
    done.reduce((sum, o) => sum + o.datedBlockLines, 0),
    done.reduce((sum, o) => sum + o.blockLines, 0),
  );
  const product = {
    ...rateMetrics('accuracy', accuracy),
    ...rateMetrics('dateVisibleShare', dateVisible),
  };
  const grepLines = cases.map((c) => ({
    temporalCase: c,
    lines: grepByDate(sessions, c.date),
  }));
  const baselines = [
    {
      id: 'raw-grep',
      label: 'Raw grep of timestamped session records on the case date',
      metrics: {
        ...rateMetrics(
          'accuracy',
          rate(
            grepLines.filter(({ temporalCase, lines }) =>
              lines.some((line) =>
                hasValue(temporalCase.expectedAnswer, { chunk: line }),
              ),
            ).length,
            cases.length,
          ),
        ),
        ...rateMetrics(
          'dateVisibleShare',
          rate(
            grepLines.reduce(
              (sum, { lines }) =>
                sum + lines.filter((line) => ISO_DATE.test(line)).length,
              0,
            ),
            grepLines.reduce((sum, { lines }) => sum + lines.length, 0),
          ),
        ),
      },
    },
    {
      id: 'no-memory',
      label: 'No memory',
      metrics: {
        ...rateMetrics('accuracy', rate(0, cases.length)),
        ...rateMetrics('dateVisibleShare', rate(0, 0)),
      },
    },
  ];
  const naReason =
    naReasonOf(statuses, cases.length < MIN_TEMPORAL_CASES) ??
    MIRRORED_COMMIT_NA;

  writeSuiteResult(
    context.runDir,
    {
      suiteId: TEMPORAL_SUITE_ID,
      kind: 'curation',
      arm: 'memory',
      details: {
        operation: 'temporal',
        cases: done.length,
        accuracy: accuracy.value,
        dateVisibleShare: dateVisible.value,
      },
      claim: {
        source: 'ledger',
        ref: '.ptah/specs/TASK_2026_620_a13e/benchmark-design.md:95',
        text: 'Dated recall',
      },
      groundTruth: GROUND_TRUTH,
      baselines,
      deltas: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          deltaOf(product, baseline.metrics, ['accuracy', 'dateVisibleShare']),
        ]),
      ),
      cost: log.cost(),
      modelCalls: log.calls,
      // Always na: the commit step is a mirror of private product code.
      verdict: 'na',
      naReason,
      metrics: product,
      cassetteVersion: log.calls === 0 ? null : options.cassetteVersion,
    },
    records,
  );
}

/** The three suites, for the host's `HOST_SUITES`. */
export function createUpdateSuites(
  deps: UpdateSuiteDeps,
): readonly MemorySkillsHostSuite[] {
  return [
    { id: UPDATE_SUITE_ID, run: (context) => runUpdate(context, deps) },
    { id: TEMPORAL_SUITE_ID, run: (context) => runTemporal(context, deps) },
    createSeedSuite(deps),
  ];
}
