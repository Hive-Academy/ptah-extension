/**
 * Turns one run's suite files into 619 scorecard parts (benchmark-design.md
 * 6.4, 6.5, 7 R-C4): reads every plan suite's result, derives `cost.source`,
 * forces `na: zero-cases` on a suite that executed no case (R-L5a), adds the
 * deterministic `projectionSha256`, and summarises per-case runtime and
 * safety-cap retries (R11). The run-level parts (product, corpus, guard,
 * artefacts) are assembled here too; `run-memory-skills.ts` writes them.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { z } from 'zod';

import type {
  Scorecard,
  ScorecardSuite,
} from '../../scorecard/scorecard.types';
import type { GuardReport } from '../../transport/real-state-guard';
import { computeSuiteProjectionSha256 } from '../projection';
import { SAFETY_CAP_ERROR, SAFETY_CAP_MS } from './case-runner';
import type { HostCompletionView, RunnerHost } from './host-completion-reader';
import type { OfflineStatus } from './offline-suites';
import type { ReadPathGuard, GitRunner } from './read-path-guard';
import {
  COMMITTED_FIXTURES_DIR,
  MemorySkillsRunError,
  type RunnerPlan,
} from './runner-plan';
import {
  readSuiteResult,
  suiteCasesFile,
  suiteResultFile,
  type CaseRecord,
  type SuiteResult,
} from './suite-result';

/** The desktop app ships the memory curator and skill synthesis measured here. */
export const PRODUCT_PACKAGE_JSON = 'apps/ptah-electron/package.json';

export type SuitePlacement = 'host' | 'offline';

export interface ScoredSuite {
  readonly placement: SuitePlacement;
  readonly result: SuiteResult;
  readonly cases: readonly CaseRecord[];
}

export interface MissingSuite {
  readonly placement: SuitePlacement;
  readonly id: string;
  readonly reason: string;
}

export interface SuiteSummary {
  readonly id: string;
  readonly placement: SuitePlacement;
  readonly status: 'scored' | 'missing';
  /** Why a `missing` suite has no result. */
  readonly reason?: string;
  readonly verdict: 'pass' | 'fail' | 'na';
  readonly naReason?: string;
  readonly costSource?: ScorecardSuite['cost']['source'];
  readonly cases: number;
  readonly maxCaseLatencyMs: number | null;
  readonly safetyCapCases: number;
  readonly retriedCases: number;
}

export function scorecardOs(platform: NodeJS.Platform): Scorecard['run']['os'] {
  if (platform === 'win32' || platform === 'linux') return platform;
  throw new MemorySkillsRunError(
    `the scorecard records win32 or linux runs only, not ${platform}`,
  );
}

/** Product version (committed package.json) and commit (`-dirty` with tracked changes). */
export function readProduct(
  guard: ReadPathGuard,
  git: GitRunner,
  repoRoot: string,
): { product: Scorecard['product']; head: string } {
  const pkg = z
    .object({ version: z.string().min(1) })
    .parse(JSON.parse(guard.readText(join(repoRoot, PRODUCT_PACKAGE_JSON))));
  const head = git(['rev-parse', 'HEAD']).trim();
  const dirty =
    git(['status', '--porcelain=v1', '--untracked-files=no']).trim().length > 0;
  return {
    product: { version: pkg.version, commit: dirty ? `${head}-dirty` : head },
    head,
  };
}

/** The committed fixtures are this bench's corpus. */
export function readCorpus(
  guard: ReadPathGuard,
  repoRoot: string,
  head: string,
  committedFiles: ReadonlySet<string>,
): Scorecard['corpus'] {
  const manifest = z
    .object({
      dependencies: z.record(z.string(), z.string()).optional(),
      devDependencies: z.record(z.string(), z.string()).optional(),
    })
    .parse(JSON.parse(guard.readText(join(repoRoot, 'package.json'))));
  const tsVersion =
    manifest.devDependencies?.['typescript'] ??
    manifest.dependencies?.['typescript'];
  if (tsVersion === undefined) {
    throw new MemorySkillsRunError('package.json declares no typescript');
  }
  return {
    repo: 'ptah-extension',
    commit: head,
    eligibleFiles: [...committedFiles].filter((path) =>
      path.startsWith(`${COMMITTED_FIXTURES_DIR}/`),
    ).length,
    tsVersion,
  };
}

/** Every plan suite as scored (its files read) or missing (with the reason). */
export function collectSuites(
  plan: RunnerPlan,
  runDir: string,
  completion: HostCompletionView | null,
  offline: ReadonlyMap<string, OfflineStatus>,
  guard: ReadPathGuard,
): { scored: ScoredSuite[]; missing: MissingSuite[] } {
  const scored: ScoredSuite[] = [];
  const missing: MissingSuite[] = [];
  const read = (placement: SuitePlacement, id: string): void => {
    try {
      // A link planted at either name must not redirect the parent's read.
      guard.assertReadable(join(runDir, suiteResultFile(id)));
      guard.assertReadable(join(runDir, suiteCasesFile(id)));
      scored.push({ placement, ...readSuiteResult(runDir, id) });
    } catch (error: unknown) {
      missing.push({
        placement,
        id,
        reason: `invalid-result: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  const hostRecords = new Map(
    (completion?.suites ?? []).map((record) => [record.id, record]),
  );
  for (const entry of plan.hostSuites) {
    const record = hostRecords.get(entry.id);
    if (completion === null) {
      missing.push({
        placement: 'host',
        id: entry.id,
        reason: 'host-incomplete',
      });
    } else if (record === undefined) {
      missing.push({ placement: 'host', id: entry.id, reason: 'not-run' });
    } else if (record.status === 'completed') {
      read('host', entry.id);
    } else if (record.status === 'error') {
      missing.push({
        placement: 'host',
        id: entry.id,
        reason: `suite-error: ${record.error}`,
      });
    } else {
      missing.push({ placement: 'host', id: entry.id, reason: record.reason });
    }
  }
  for (const entry of plan.offlineSuites) {
    const status = offline.get(entry.id);
    if (status?.status === 'completed') read('offline', entry.id);
    else
      missing.push({
        placement: 'offline',
        id: entry.id,
        reason:
          status === undefined ? 'not-run' : `suite-error: ${status.error}`,
      });
  }
  return { scored, missing };
}

/**
 * One scorecard suite: `cost.source` is `none` without model calls, else
 * `cassette` in replay and `live` in record; zero executed cases make a
 * non-`na` verdict `na: zero-cases`; the projection hash covers the final
 * verdict.
 */
export function toScorecardSuite(
  scored: ScoredSuite,
  cassetteMode: RunnerPlan['cassetteMode'],
  run: { runId: string; startedAt: string; host: RunnerHost },
): ScorecardSuite {
  const {
    kind,
    displayLabel,
    details,
    claim,
    groundTruth,
    arm,
    baselines,
    deltas,
    modelCalls,
    cassetteVersion,
    cost,
    verdict,
    naReason,
  } = scored.result;
  const zeroCases = scored.cases.length === 0 && verdict !== 'na';
  const source: ScorecardSuite['cost']['source'] =
    modelCalls === 0 ? 'none' : cassetteMode === 'replay' ? 'cassette' : 'live';
  const suite: ScorecardSuite = {
    kind,
    ...(displayLabel === undefined ? {} : { displayLabel }),
    details,
    claim,
    groundTruth,
    ...(arm === undefined ? {} : { arm }),
    baselines,
    deltas,
    cost: { ...cost, source },
    verdict: zeroCases ? 'na' : verdict,
    ...(zeroCases
      ? { naReason: 'zero-cases' }
      : naReason === undefined
        ? {}
        : { naReason }),
  };
  return {
    ...suite,
    projectionSha256: computeSuiteProjectionSha256({
      suite,
      cases: scored.cases,
      cassetteVersion,
      run: {
        runId: run.runId,
        startedAt: run.startedAt,
        hostPid: run.host.pid,
        hostPort: run.host.port,
        safetyCapMs: SAFETY_CAP_MS,
      },
    }),
  };
}

function caseStats(cases: readonly CaseRecord[]): {
  maxCaseLatencyMs: number | null;
  safetyCapCases: number;
  retriedCases: number;
} {
  return {
    maxCaseLatencyMs:
      cases.length === 0 ? null : Math.max(...cases.map((c) => c.latencyMs)),
    safetyCapCases: cases.filter((c) => c.error === SAFETY_CAP_ERROR).length,
    retriedCases: cases.filter((c) => (c.attempts ?? 1) > 1).length,
  };
}

/** `suites[i]` is the scorecard suite of `scored[i]`. */
export function summariseSuites(
  scored: readonly ScoredSuite[],
  suites: readonly ScorecardSuite[],
  missing: readonly MissingSuite[],
): SuiteSummary[] {
  return [
    ...scored.map((entry, index): SuiteSummary => {
      const suite = suites[index];
      return {
        id: entry.result.suiteId,
        placement: entry.placement,
        status: 'scored',
        verdict: suite.verdict,
        ...(suite.naReason === undefined ? {} : { naReason: suite.naReason }),
        costSource: suite.cost.source,
        cases: entry.cases.length,
        ...caseStats(entry.cases),
      };
    }),
    ...missing.map((entry): SuiteSummary => ({
      id: entry.id,
      placement: entry.placement,
      status: 'missing',
      reason: entry.reason,
      verdict: 'na',
      naReason: entry.reason,
      cases: 0,
      maxCaseLatencyMs: null,
      safetyCapCases: 0,
      retriedCases: 0,
    })),
  ];
}

export function guardSummary(report: GuardReport): Scorecard['run']['guard'] {
  if (report.mode === 'hash') return { partial: false, unprobed: [] };
  return {
    partial: report.partial,
    unprobed: report.unprobedProcesses.map((item) => ({ ...item })),
  };
}

/**
 * A run-relative artefact reference, or `null` when the file was not written.
 * The bytes are read through the guard, like every other parent read.
 */
export function runArtifact(
  guard: ReadPathGuard,
  runDir: string,
  file: string,
  kind: string,
  schemaId: string,
): Scorecard['artifacts'][number] | null {
  const path = guard.assertReadable(join(runDir, file));
  if (!existsSync(path)) return null;
  return {
    kind,
    path: relative(runDir, path).split(sep).join('/'),
    sha256: createHash('sha256').update(guard.readBytes(path)).digest('hex'),
    schemaId,
  };
}
