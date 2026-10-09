/**
 * `mem.liveness.fault` and `mem.liveness.rescan` (benchmark-design.md 3.8).
 * Host suites. They drive the product's own trigger code, not a copy of it:
 * `MemoryTriggerService.invokeCurate` (observation path: drain, curate, mark
 * processed) and `MemoryTriggerService.runBootScan` (boot scan, `BootScanRunner`,
 * watermark), on a suite-local `MemoryTriggerService` + `MemoryCuratorService`
 * built in a child container whose `CURATOR_LLM` is `ScriptedLivenessCurator`
 * (`liveness-harness.ts`).
 * Everything else (stores, SQLite, transcript reader, rate limiter) is the
 * booted host's.
 *
 * Why a scripted curator and not the plan's cassette double: the fault
 * double selects faults by cassette key, and the observation path's
 * transcript (`composeTranscript`) is only known inside the trigger. The
 * scripted curator selects a mode per session by a marker the suite plants
 * (`LV-…`), and reproduces each fault through `RecordedCuratorLlm`'s own
 * fault arm, so the error shapes are the double's. It is not a model and has
 * no cassette: `modelCalls` is 0 and `cost.calls` counts its calls.
 *
 * `invokeCurate` and `runBootScan` are private in the product. They are
 * reached through `triggerInternals` (`liveness-harness.ts`), which fails closed when either is
 * renamed; a product seam would remove the cast (see the batch report).
 *
 * Fault cases (design 3.8): (a) non-network throw, (b) zero drafts,
 * (c) timeout — each on the observation path: the drained observations must
 * stay unprocessed, and (a)/(c) must not report `'ran'`; (d) a boot scan
 * where one session throws among two successes: the watermark must stay below
 * the failed session. Upstream curator fixes (2521773ad, aae3e441a,
 * a181ab1b2) make (a), (c), and (d) pass; (b) remains the failing case. A
 * `stalled` control shows the harness can see a kept observation. The frozen
 * baseline predates those upstream fixes and is historic, so its deltas record
 * change since the freeze rather than a change made by this suite. The suite
 * verdict is always `na` ({@link HARNESS_ONLY_REASON}): the cases are harness
 * evidence.
 *
 * Rescan (M2 mode (e)): the same seeded transcripts are boot-scanned twice;
 * before the second scan their mtimes are moved to fixed later values with
 * `fs.utimes`, content unchanged. New rows, new chunks, extra curator calls
 * and duplicate-content groups must all be 0. Expected today: > 0.
 *
 * Fixed mtimes lie in 2100: the boot scan floors a cold watermark at
 * `now - 7 days` (`boot-scan-runner.ts:81`), so a fixed past date would age
 * out; a fixed future date never does and keeps every value deterministic.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { z } from 'zod';

import type { CuratorFaultMode } from '../../doubles/recorded-curator-llm';
import {
  fixedDailyClock,
  generateSeededSession,
  parseDistractorBank,
  type DistractorBankRecord,
  type SeededSession,
} from '../../ground-truth/seeded-session-generator';
import type { MemorySkillsHostSuite } from '../../host/memory-skills-host';
import {
  livenessDetailsSchema,
  type LivenessDetails,
} from '../../memory-skills-suite-kinds';
import { rate } from '../../metrics/curation-metrics';
import { runCaseWithSafetyCap } from '../../runner/case-runner';
import {
  writeSuiteResult,
  type CaseRecord,
  type SuiteResultInput,
} from '../../runner/suite-result';
import {
  hostLivenessParts,
  invokeObservationPass,
  runBootScan,
  snapshot,
  type BootScanStats,
  type CurateObservation,
  type LivenessParts,
  type RowSnapshot,
} from './liveness-harness';

export const LIVENESS_FAULT_SUITE_ID = 'mem.liveness.fault';
export const LIVENESS_RESCAN_SUITE_ID = 'mem.liveness.rescan';

const SECOND_MS = 1000;
/** Fixed mtimes (epoch ms) of the boot-scan cases; see the module header. */
export const LIVENESS_MTIMES = {
  fault: Date.UTC(2100, 0, 1),
  rescanFirst: Date.UTC(2100, 0, 2),
  rescanSecond: Date.UTC(2100, 0, 3),
} as const;

const OBSERVATIONS_PER_CASE = 3;

/**
 * Both suites run the product's trigger code, but through a scripted curator
 * and two private methods reached by a cast, so a result is evidence about
 * that harness, not about the product. Every verdict is therefore `na` with
 * this reason ("not measurable yet" in the ledger) until a public product
 * seam exists (batch-17-report.md, "Phase 3.5 fixes").
 */
export const HARNESS_ONLY_REASON =
  'harness-only: scripted curator and private trigger methods';

export const livenessOptionsSchema = z
  .strictObject({
    distractorsFile: z
      .string()
      .min(1)
      .default('memory-skills/distractors.v1.jsonl'),
    /** The baseline "value recorded at freeze" (design R-L5), per metric. */
    recordedAtFreeze: z.record(z.string(), z.number().nullable()).optional(),
    capMs: z.number().int().positive().optional(),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function fixturePath(home: string, relative: string): string {
  const root = resolve(home);
  const full = resolve(root, relative);
  if (!full.startsWith(`${root}${sep}`)) {
    throw new Error(`fixture ${relative} lies outside the isolated home`);
  }
  return full;
}

function readBank(home: string, relative: string): DistractorBankRecord[] {
  return parseDistractorBank(readFileSync(fixturePath(home, relative), 'utf8'));
}

function markerSession(
  bank: readonly DistractorBankRecord[],
  marker: string,
): SeededSession {
  return generateSeededSession({
    seed: 'TASK_2026_620:liveness',
    planting: {
      factId: marker.toLowerCase(),
      statement: `Liveness marker ${marker}: this session is a liveness fixture.`,
      date: '2026-10-01',
    },
    bank,
    clock: fixedDailyClock,
  });
}

interface WrittenSession {
  readonly session: SeededSession;
  readonly path: string;
}

function writeSessions(
  parts: LivenessParts,
  sessions: readonly SeededSession[],
  firstMtime: number,
): WrittenSession[] {
  mkdirSync(parts.sessionsDir, { recursive: true });
  return sessions.map((session, index) => {
    const path = join(parts.sessionsDir, `${session.sessionId}.jsonl`);
    writeFileSync(path, session.jsonl, { encoding: 'utf8', flag: 'wx' });
    setMtime(path, firstMtime + index * 60 * SECOND_MS);
    return { session, path };
  });
}

function setMtime(path: string, mtimeMs: number): void {
  const at = new Date(mtimeMs);
  utimesSync(path, at, at);
}

function removeSessions(written: readonly WrittenSession[]): void {
  for (const entry of written) rmSync(entry.path, { force: true });
}

function iso(ms: number | null): string {
  return ms === null ? 'none' : new Date(ms).toISOString();
}

function percentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)
  ];
}

function freezeBaseline(
  recorded: Readonly<Record<string, number | null>> | undefined,
  metrics: Readonly<Record<string, number | null>>,
): Pick<SuiteResultInput, 'baselines' | 'deltas'> {
  const values: Record<string, number | null> = {};
  const deltas: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(metrics)) {
    const frozen = recorded?.[key] ?? null;
    values[key] = frozen;
    deltas[key] = frozen === null || value === null ? null : value - frozen;
  }
  return {
    baselines: [
      {
        id: 'recorded-at-freeze',
        label: 'value recorded at freeze (known-failures.v1.json)',
        metrics: values,
      },
    ],
    deltas: { 'recorded-at-freeze': deltas },
  };
}

function emptyDetails(source: LivenessDetails['source']): LivenessDetails {
  return {
    source,
    rescan: null,
    snapshotSha256: null,
    unprocessedAgeP95Ms: null,
    sessionsWithObservationsNoMemories: null,
    ranPassesWithError: null,
    faults: [],
  };
}

interface SuiteRunInput {
  readonly runDir: string;
  readonly home: string;
  readonly options: unknown;
  readonly parts: LivenessParts;
}

// ---------------------------------------------------------------------------
// mem.liveness.fault
// ---------------------------------------------------------------------------

const OBSERVATION_FAULTS = [
  { letter: 'a', mode: 'throw', label: 'a: non-network throw', notRan: true },
  { letter: 'b', mode: 'zero-drafts', label: 'b: zero drafts', notRan: false },
  { letter: 'c', mode: 'timeout', label: 'c: timeout', notRan: true },
] as const;

interface FaultCase {
  readonly record: CaseRecord;
  readonly fault: LivenessDetails['faults'][number] | null;
  /** A pass that reported `'ran'` although its call failed. */
  readonly ranWithError: number;
  readonly stalledScan: boolean;
}

async function observationCase(
  parts: LivenessParts,
  caseId: string,
  mode: CuratorFaultMode,
  expectNotRan: boolean,
  capMs: number | undefined,
): Promise<{
  record: CaseRecord;
  outcome: CurateObservation['outcome'];
  pass: boolean;
  expected: string;
  observed: string;
}> {
  const marker = `LV-${caseId.replace(/[^a-z0-9]/g, '')}`;
  const sessionId = `liveness-${caseId.replace(/[^a-z0-9]/g, '-')}`;
  const texts = Array.from(
    { length: OBSERVATIONS_PER_CASE },
    (_, index) =>
      `Keep this for later (${marker}): durable observation ${index + 1}.`,
  );
  for (const text of texts) {
    parts.observations.enqueue({
      sessionId,
      workspaceRoot: parts.workspaceRoot,
      kind: 'user-prompt',
      userPrompt: text,
    });
  }
  const before = parts.observations.countUnprocessed(sessionId);
  if (before !== OBSERVATIONS_PER_CASE) {
    throw new Error(
      `${caseId}: expected ${OBSERVATIONS_PER_CASE} unprocessed observations before the pass, found ${before}`,
    );
  }
  parts.model.setFault(marker, mode);
  let observedOutcome: CurateObservation;
  let latencyMs: number;
  let attempts: number;
  try {
    const run = await runCaseWithSafetyCap(
      () => invokeObservationPass(parts, sessionId),
      capMs === undefined ? {} : { capMs },
    );
    if (run.outcome !== 'completed') {
      throw new Error(`${caseId}: the pass hit the safety cap`);
    }
    observedOutcome = run.value;
    latencyMs = run.latencyMs;
    attempts = run.attempts;
  } finally {
    parts.model.clearFaults();
  }
  const after = parts.observations.countUnprocessed(sessionId);
  const kept = after === before;
  const outcomeOk = !expectNotRan || observedOutcome.outcome !== 'ran';
  const pass = kept && outcomeOk;
  const expected =
    `${before} observations stay unprocessed` +
    (expectNotRan ? "; pass outcome is not 'ran'" : '');
  const observed = `pass outcome '${observedOutcome.outcome}'; ${after} of ${before} observations unprocessed`;
  return {
    record: {
      caseId,
      inputSha256: sha256(texts.join('\n')),
      expected,
      observed,
      outcome: pass ? 'pass' : 'fail',
      cassetteKey: null,
      latencyMs,
      attempts,
      error: null,
    },
    outcome: observedOutcome.outcome,
    pass,
    expected,
    observed,
  };
}

async function bootScanFaultCase(
  parts: LivenessParts,
  bank: readonly DistractorBankRecord[],
): Promise<FaultCase> {
  const markers = ['LV-d1', 'LV-d2', 'LV-d3'];
  const failedMarker = 'LV-d2';
  const failedMtime = LIVENESS_MTIMES.fault + 60 * SECOND_MS;
  const watermarkBefore = parts.readWatermark();
  if (watermarkBefore !== null && watermarkBefore >= LIVENESS_MTIMES.fault) {
    throw new Error(
      `fault/d-boot-scan: the watermark ${iso(watermarkBefore)} already covers the case's sessions`,
    );
  }
  const written = writeSessions(
    parts,
    markers.map((marker) => markerSession(bank, marker)),
    LIVENESS_MTIMES.fault,
  );
  const outcomesBefore = parts.outcomes.length;
  const callsBefore = parts.model.calls();
  parts.model.setFault(failedMarker, 'throw');
  const started = performance.now();
  let stats: BootScanStats;
  try {
    stats = await runBootScan(parts);
  } finally {
    parts.model.clearFaults();
    removeSessions(written);
  }
  const latencyMs = performance.now() - started;
  if (parts.model.calls() - callsBefore < markers.length) {
    throw new Error(
      'fault/d-boot-scan: the boot scan never reached the curator for every session (sessions directory or transcript reader)',
    );
  }
  const watermark = parts.readWatermark();
  const outcomes = parts.outcomes
    .slice(outcomesBefore)
    .map((entry) => entry.outcome);
  const pass = watermark === null || watermark < failedMtime;
  const expected = `watermark stays below the failed session (${iso(failedMtime)})`;
  const observed =
    `watermark ${iso(watermark)}; scan scanned ${stats.scanned}, succeeded ` +
    `${stats.succeeded}, skipped ${stats.skipped}, stalled ${stats.stalled}; ` +
    `curate outcomes ${outcomes.join(', ')}`;
  return {
    record: {
      caseId: 'fault/d-boot-scan',
      inputSha256: sha256(written.map((entry) => entry.session.jsonl).join('')),
      expected,
      observed,
      outcome: pass && stats.stalled === 0 ? 'pass' : 'fail',
      cassetteKey: null,
      latencyMs,
      error: stats.stalled > 0 ? 'boot-scan-stalled' : null,
    },
    fault: {
      fault: 'd: boot-scan session throws among successes',
      expected,
      observed,
      pass,
    },
    // The failed session is the middle one in mtime order.
    ranWithError: outcomes[1] === 'ran' ? 1 : 0,
    stalledScan: stats.stalled > 0,
  };
}

export async function runLivenessFaultSuite(
  input: SuiteRunInput,
): Promise<{ result: SuiteResultInput; cases: CaseRecord[] }> {
  const options = livenessOptionsSchema.parse(input.options);
  const bank = readBank(input.home, options.distractorsFile);
  const { parts } = input;
  const callsBefore = parts.model.calls();
  const cases: FaultCase[] = [];
  for (const spec of OBSERVATION_FAULTS) {
    const run = await observationCase(
      parts,
      `fault/${spec.letter}-${spec.mode}`,
      spec.mode,
      spec.notRan,
      options.capMs,
    );
    cases.push({
      record: run.record,
      fault: {
        fault: spec.label,
        expected: run.expected,
        observed: run.observed,
        pass: run.pass,
      },
      ranWithError: spec.notRan && run.outcome === 'ran' ? 1 : 0,
      stalledScan: false,
    });
  }
  cases.push(await bootScanFaultCase(parts, bank));
  // Last: a provider-unreachable stall opens the curator's network back-off,
  // which would hold every later pass of this curator.
  const control = await observationCase(
    parts,
    'control/stalled',
    'stalled',
    true,
    options.capMs,
  );
  cases.push({
    record: control.record,
    fault: null,
    ranWithError: 0,
    stalledScan: false,
  });

  const faults = cases.flatMap((c) => (c.fault === null ? [] : [c.fault]));
  const ranPassesWithError = cases.reduce((sum, c) => sum + c.ranWithError, 0);
  const passRate = rate(
    faults.filter((fault) => fault.pass).length,
    faults.length,
  );
  const details = livenessDetailsSchema.parse({
    ...emptyDetails('fault-injection'),
    ranPassesWithError,
    faults,
  });
  const metrics = { 'faults.passRate': passRate.value, ranPassesWithError };
  const records = cases.map((c) => c.record);
  const stalled = cases.some((c) => c.stalledScan);
  // Harness-only (Phase 3.5 review finding 3): the measured numbers stay in
  // `details`, `metrics` and the case records; the verdict never claims a
  // product result.
  const verdict: SuiteResultInput['verdict'] = 'na';
  const naReason = !control.pass
    ? 'control-failed'
    : stalled
      ? 'boot-scan-stalled'
      : HARNESS_ONLY_REASON;
  return finish(input.runDir, {
    suiteId: LIVENESS_FAULT_SUITE_ID,
    details,
    claim: {
      source: 'code',
      ref: 'libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:823-884',
      text: 'a pass that consumed nothing leaves its observations and the watermark where they were',
    },
    metrics,
    recordedAtFreeze: options.recordedAtFreeze,
    records,
    calls: parts.model.calls() - callsBefore,
    verdict,
    naReason,
  });
}

// ---------------------------------------------------------------------------
// mem.liveness.rescan
// ---------------------------------------------------------------------------

export async function runLivenessRescanSuite(
  input: SuiteRunInput,
): Promise<{ result: SuiteResultInput; cases: CaseRecord[] }> {
  const options = livenessOptionsSchema.parse(input.options);
  const bank = readBank(input.home, options.distractorsFile);
  const { parts } = input;
  const markers = ['LV-r1', 'LV-r2', 'LV-r3'];
  const watermarkBefore = parts.readWatermark();
  if (
    watermarkBefore !== null &&
    watermarkBefore >= LIVENESS_MTIMES.rescanFirst
  ) {
    throw new Error(
      `the watermark ${iso(watermarkBefore)} already covers the rescan sessions`,
    );
  }
  const written = writeSessions(
    parts,
    markers.map((marker) => markerSession(bank, marker)),
    LIVENESS_MTIMES.rescanFirst,
  );
  const callsStart = parts.model.calls();
  const started = performance.now();
  let first: BootScanStats;
  let second: BootScanStats;
  let rows0: RowSnapshot;
  let rows1: RowSnapshot;
  let rows2: RowSnapshot;
  let calls1: number;
  let firstShas: Set<string>;
  let unseenOnSecond: number;
  try {
    rows0 = snapshot(parts);
    first = await runBootScan(parts);
    rows1 = snapshot(parts);
    calls1 = parts.model.calls();
    firstShas = new Set(
      written.map((entry) => sha256(readFileSync(entry.path, 'utf8'))),
    );
    written.forEach((entry, index) =>
      setMtime(
        entry.path,
        LIVENESS_MTIMES.rescanSecond + index * 60 * SECOND_MS,
      ),
    );
    unseenOnSecond = written.filter(
      (entry) => !firstShas.has(sha256(readFileSync(entry.path, 'utf8'))),
    ).length;
    second = await runBootScan(parts);
    rows2 = snapshot(parts);
  } finally {
    removeSessions(written);
  }
  const latencyMs = performance.now() - started;
  const firstCalls = calls1 - callsStart;
  const vacuous = firstCalls < markers.length || rows1.rows <= rows0.rows;

  const newRows = rows2.rows - rows1.rows;
  const newChunks = rows2.chunks - rows1.chunks;
  const extraModelCalls = parts.model.calls() - calls1;
  const duplicateGroupsDelta = rows2.duplicateGroups - rows1.duplicateGroups;
  if (newRows < 0 || newChunks < 0 || duplicateGroupsDelta < 0) {
    throw new Error(
      'rows disappeared between the two scans; nothing else may write during the rescan',
    );
  }
  const inputSha256 = sha256(
    written.map((entry) => entry.session.jsonl).join(''),
  );
  const scans =
    `first scan ${first.succeeded}/${first.scanned} sessions, second scan ` +
    `${second.succeeded}/${second.scanned}`;
  const zeroCase = (
    caseId: string,
    label: string,
    value: number,
  ): CaseRecord => ({
    caseId,
    inputSha256,
    expected: `${label} = 0 on the second scan`,
    observed: `${label} = ${value} (${scans})`,
    outcome: value === 0 && !vacuous ? 'pass' : 'fail',
    cassetteKey: null,
    latencyMs,
    error: vacuous ? 'vacuous-first-scan' : null,
  });
  const records = [
    zeroCase('rescan/new-rows', 'new rows', newRows),
    zeroCase('rescan/new-chunks', 'new chunks', newChunks),
    zeroCase(
      'rescan/extra-model-calls',
      'extra curator calls',
      extraModelCalls,
    ),
    zeroCase(
      'rescan/duplicate-groups',
      'duplicate-content groups added',
      duplicateGroupsDelta,
    ),
  ];
  const details = livenessDetailsSchema.parse({
    ...emptyDetails('rescan'),
    rescan: { newRows, extraModelCalls, duplicateGroupsDelta },
  });
  const metrics = {
    'rescan.newRows': newRows,
    'rescan.newChunks': newChunks,
    'rescan.extraModelCalls': extraModelCalls,
    'rescan.duplicateGroupsDelta': duplicateGroupsDelta,
    'rescan.sessionsRecurated': second.succeeded,
  };
  const stalled = first.stalled > 0 || second.stalled > 0;
  // Harness-only, as for the fault suite.
  const verdict: SuiteResultInput['verdict'] = 'na';
  const naReason = vacuous
    ? 'vacuous-first-scan'
    : stalled
      ? 'boot-scan-stalled'
      : HARNESS_ONLY_REASON;
  const outcome = finish(input.runDir, {
    suiteId: LIVENESS_RESCAN_SUITE_ID,
    details,
    claim: {
      source: 'code',
      ref: 'libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts:133-143',
      text: 'a session already curated is not curated again',
    },
    metrics,
    recordedAtFreeze: options.recordedAtFreeze,
    // A pure policy: skip a session whose content hash was already curated.
    extraBaseline: {
      id: 'transcript-hash-dedup',
      label:
        'transcript-hash dedup (skip a session whose content sha256 was curated)',
      metrics: { 'rescan.sessionsRecurated': unseenOnSecond },
    },
    records,
    calls: parts.model.calls() - callsStart,
    verdict,
    naReason,
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Result assembly and host wiring
// ---------------------------------------------------------------------------

function finish(
  runDir: string,
  input: {
    suiteId: string;
    details: LivenessDetails;
    claim: SuiteResultInput['claim'];
    metrics: Record<string, number | null>;
    recordedAtFreeze: Readonly<Record<string, number | null>> | undefined;
    extraBaseline?: SuiteResultInput['baselines'][number];
    records: CaseRecord[];
    calls: number;
    verdict: SuiteResultInput['verdict'];
    naReason: string | undefined;
  },
): { result: SuiteResultInput; cases: CaseRecord[] } {
  const frozen = freezeBaseline(input.recordedAtFreeze, input.metrics);
  const latencies = input.records.map((record) => record.latencyMs);
  const result: SuiteResultInput = {
    suiteId: input.suiteId,
    kind: 'liveness',
    details: input.details,
    claim: input.claim,
    groundTruth: {
      id: 'liveness-fault-cases',
      version: 'v1',
      method: 'seeded',
    },
    baselines: [
      ...frozen.baselines,
      ...(input.extraBaseline === undefined ? [] : [input.extraBaseline]),
    ],
    deltas: frozen.deltas,
    cost: {
      calls: input.calls,
      latency_ms: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
      },
      error_rate: rate(
        input.records.filter((record) => record.error != null).length,
        input.records.length,
      ).value,
      tokens: {},
    },
    // The scripted curator is not a model: no cassette, no model calls.
    modelCalls: 0,
    verdict: input.verdict,
    ...(input.naReason === undefined ? {} : { naReason: input.naReason }),
    metrics: input.metrics,
    cassetteVersion: null,
  };
  writeSuiteResult(runDir, result, input.records);
  return { result, cases: input.records };
}

export function createLivenessSuites(): MemorySkillsHostSuite[] {
  return [
    {
      id: LIVENESS_FAULT_SUITE_ID,
      run: async (context) => {
        await runLivenessFaultSuite({
          runDir: context.runDir,
          home: context.isolation.home,
          options: context.options,
          parts: hostLivenessParts(context),
        });
      },
    },
    {
      id: LIVENESS_RESCAN_SUITE_ID,
      run: async (context) => {
        await runLivenessRescanSuite({
          runDir: context.runDir,
          home: context.isolation.home,
          options: context.options,
          parts: hostLivenessParts(context),
        });
      },
    },
  ];
}
