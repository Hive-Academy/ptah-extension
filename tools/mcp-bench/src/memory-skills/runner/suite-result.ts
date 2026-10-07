/**
 * The file contract between a memory-skills suite and the runner parent
 * (benchmark-design.md 6.4). Every suite, whether it runs in the bench host
 * or offline in the parent, leaves two files in the run directory:
 *   - `<suiteId>.cases.jsonl`: one {@link CaseRecord} per case;
 *   - `<suiteId>.suite.json`: the {@link SuiteResult} (schema
 *     `620.suite-result.v1`), written last, so its presence means both files
 *     are complete.
 * The runner reads them back, sets `cost.source` and `projectionSha256`, and
 * hands the suite to 619's scorecard writers.
 *
 * The suite fields are 619's `suiteCoreSchema` (`scorecard.types.ts`),
 * extended with the 620-only fields; `cost.source` and `projectionSha256`
 * are refused here because only the runner sets them. The writers validate
 * the assembled scorecard again against 619's full schema (kind checks).
 *
 * This module imports only Node, zod, 619's scorecard types and the label
 * schemas (no product barrel), so host suites can load it.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { suiteCoreSchema } from '../../scorecard/scorecard.types';
import type { SuiteView } from '../../scorecard/suite-kinds';
import { sha256HexSchema } from '../ground-truth/label-schemas';

export const SUITE_RESULT_SCHEMA_ID = '620.suite-result.v1';

/** Suite ids name files in the run directory; the host plan uses the same rule. */
export const suiteIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9.-]*$/,
    'suite id: lower-case letters, digits, "." and "-"',
  );

const nonEmpty = z.string().min(1);
const metricValue = z.number().finite().nullable();

/** One line of `<suiteId>.cases.jsonl`. `latencyMs` is required: R11 records every case's runtime. */
export const caseRecordSchema = z.strictObject({
  caseId: nonEmpty,
  inputSha256: sha256HexSchema,
  expected: z.string(),
  observed: z.string(),
  outcome: z.enum(['pass', 'fail']),
  baselineOutcomes: z.record(nonEmpty, z.enum(['pass', 'fail'])).optional(),
  cassetteKey: nonEmpty.nullable().optional(),
  latencyMs: z.number().finite().nonnegative(),
  /** 2 when the first attempt hit the safety cap (`case-runner.ts`). */
  attempts: z.number().int().min(1).max(2).optional(),
  error: nonEmpty.nullable().optional(),
});
export type CaseRecord = z.infer<typeof caseRecordSchema>;

/** The 620-only fields of a suite result, beside 619's suite core fields. */
const suiteResultEnvelopeSchema = z.object({
  schemaId: z.literal(SUITE_RESULT_SCHEMA_ID),
  suiteId: suiteIdSchema,
  /** Model calls among `cost.calls`; 0 makes `cost.source` `none`. */
  modelCalls: z.number().int().nonnegative(),
  /** Headline metrics the known-failures gate compares (`known-failures.v1.json`). */
  metrics: z.record(nonEmpty, metricValue),
  /** Cassette version the suite replayed or recorded; `null` without a cassette. */
  cassetteVersion: nonEmpty.nullable(),
});
type SuiteResultEnvelope = z.infer<typeof suiteResultEnvelopeSchema>;
const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'schemaId',
  'suiteId',
  'modelCalls',
  'metrics',
  'cassetteVersion',
]);

/** 619's suite core minus what only the runner sets: `cost.source` and `projectionSha256`. */
export type SuiteResultCore = Omit<
  SuiteView<unknown>,
  'cost' | 'projectionSha256'
> & { cost: Omit<SuiteView<unknown>['cost'], 'source'> };

export type SuiteResult = SuiteResultEnvelope & SuiteResultCore;

/** Stands in for the runner-set `cost.source` while 619's core schema validates the rest. */
const PLACEHOLDER_COST_SOURCE = 'none';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A suite result: the 620 envelope fields plus 619's `suiteCoreSchema`
 * (every scorecard suite field and its kind-independent checks), with
 * `cost.source` and `projectionSha256` refused because only the runner sets
 * them. Unknown top-level keys are refused.
 */
export const suiteResultSchema: z.ZodType<SuiteResult> = z
  .unknown()
  .transform((value, ctx): SuiteResult => {
    let refused = false;
    const addIssue = (message: string, path: PropertyKey[]): void => {
      refused = true;
      ctx.addIssue({ code: 'custom', message, path });
    };
    if (!isRecord(value)) {
      addIssue('a suite result must be an object', []);
      return z.NEVER;
    }
    const envelope = suiteResultEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
      for (const issue of envelope.error.issues) {
        addIssue(issue.message, issue.path);
      }
      return z.NEVER;
    }
    const coreInput = Object.fromEntries(
      Object.entries(value).filter(([key]) => !ENVELOPE_KEYS.has(key)),
    );
    if ('projectionSha256' in coreInput) {
      addIssue('projectionSha256 is set by the runner', ['projectionSha256']);
    }
    const cost = coreInput['cost'];
    if (isRecord(cost) && 'source' in cost) {
      addIssue('cost.source is set by the runner', ['cost', 'source']);
    }
    const core = suiteCoreSchema.safeParse({
      ...coreInput,
      ...(isRecord(cost)
        ? { cost: { ...cost, source: PLACEHOLDER_COST_SOURCE } }
        : {}),
    });
    if (!core.success) {
      for (const issue of core.error.issues) {
        addIssue(issue.message, issue.path);
      }
      return z.NEVER;
    }
    for (const key of Object.keys(coreInput)) {
      if (!(key in core.data)) addIssue(`unrecognized key: ${key}`, [key]);
    }
    if (refused) return z.NEVER;
    const { kind, details, claim, groundTruth, arm, baselines, deltas } =
      core.data;
    const { calls, latency_ms, error_rate, tokens } = core.data.cost;
    return {
      ...envelope.data,
      kind,
      details,
      claim,
      groundTruth,
      ...(arm === undefined ? {} : { arm }),
      baselines,
      deltas,
      cost: { calls, latency_ms, error_rate, tokens },
      verdict: core.data.verdict,
      ...(core.data.naReason === undefined
        ? {}
        : { naReason: core.data.naReason }),
    };
  });

/** A suite result without its schema id, as a suite produces it. */
export type SuiteResultInput = Omit<SuiteResult, 'schemaId'>;

/** A suite's files are missing or invalid. */
export class SuiteResultError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SuiteResultError';
  }
}

export function suiteResultFile(suiteId: string): string {
  return `${suiteId}.suite.json`;
}

export function suiteCasesFile(suiteId: string): string {
  return `${suiteId}.cases.jsonl`;
}

/**
 * Write both files of one suite into `runDir`: the cases first, the result
 * last (tmp file, then rename). Never overwrites an earlier result.
 */
export function writeSuiteResult(
  runDir: string,
  result: SuiteResultInput,
  cases: readonly CaseRecord[],
): { resultPath: string; casesPath: string } {
  const parsed = suiteResultSchema.parse({
    ...result,
    schemaId: SUITE_RESULT_SCHEMA_ID,
  });
  const lines = cases.map((record) => caseRecordSchema.parse(record));
  mkdirSync(runDir, { recursive: true });
  const resultPath = join(runDir, suiteResultFile(parsed.suiteId));
  const casesPath = join(runDir, suiteCasesFile(parsed.suiteId));
  if (existsSync(resultPath)) {
    throw new SuiteResultError(
      `suite ${parsed.suiteId} already has a result in ${runDir}`,
    );
  }
  writeFileSync(
    casesPath,
    lines.map((record) => `${JSON.stringify(record)}\n`).join(''),
    { encoding: 'utf8', flag: 'wx' },
  );
  const temp = `${resultPath}.tmp`;
  writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  renameSync(temp, resultPath);
  return { resultPath, casesPath };
}

/** Read and validate one suite's files from `runDir`. Throws {@link SuiteResultError}. */
export function readSuiteResult(
  runDir: string,
  suiteId: string,
): { result: SuiteResult; cases: CaseRecord[] } {
  const resultPath = join(runDir, suiteResultFile(suiteId));
  const casesPath = join(runDir, suiteCasesFile(suiteId));
  if (!existsSync(resultPath)) {
    throw new SuiteResultError(`suite ${suiteId} wrote no ${resultPath}`);
  }
  const result = parseWith(suiteResultSchema, readJson(resultPath), resultPath);
  if (result.suiteId !== suiteId) {
    throw new SuiteResultError(
      `${resultPath} names suite ${result.suiteId}, expected ${suiteId}`,
    );
  }
  if (!existsSync(casesPath)) {
    throw new SuiteResultError(`suite ${suiteId} wrote no ${casesPath}`);
  }
  const cases = readFileSync(casesPath, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, index }) =>
      parseWith(
        caseRecordSchema,
        parseJson(line, `${casesPath}:${index + 1}`),
        `${casesPath}:${index + 1}`,
      ),
    );
  const ids = new Set<string>();
  for (const record of cases) {
    if (ids.has(record.caseId)) {
      throw new SuiteResultError(`${casesPath} repeats case ${record.caseId}`);
    }
    ids.add(record.caseId);
  }
  return { result, cases };
}

function readJson(path: string): unknown {
  return parseJson(readFileSync(path, 'utf8'), path);
}

function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new SuiteResultError(
      `${where}: not JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SuiteResultError(
      `${where}: invalid\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
