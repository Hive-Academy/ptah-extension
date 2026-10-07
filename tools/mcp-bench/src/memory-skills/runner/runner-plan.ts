/**
 * The runner plan (`620.runner-plan.v1`): what a user hands
 * `bench-memory-skills --plan`. Paths the parent resolves (bench data folder,
 * run directory, real home, committed fixtures) are filled in by the runner
 * when it derives the host plan; `cassettes` and `fixtures` are validated by
 * the host plan schema (`host/plan.schema.ts`) at that point.
 */

import { posix } from 'node:path';

import { z } from 'zod';

import {
  hostSuitePlacement,
  suitePlacementProblems,
} from '../host/suite-placement';
import { suiteIdSchema } from './suite-result';

export const RUNNER_PLAN_SCHEMA_ID = '620.runner-plan.v1';

/** Committed synthetic fixtures (619 answer 3). */
export const COMMITTED_FIXTURES_DIR = 'tools/mcp-bench/fixtures/memory-skills';
/** The recorded-failure list (design 7), committed beside the fixtures. */
export const KNOWN_FAILURES_FILE = `${COMMITTED_FIXTURES_DIR}/known-failures.v1.json`;

/** The runner refused the run before or while launching it. */
export class MemorySkillsRunError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MemorySkillsRunError';
  }
}

/** Normalised repo-relative path with `/` separators and no `..`. */
const repoRelativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes('\\') &&
      !posix.isAbsolute(value) &&
      !/^[A-Za-z]:/.test(value) &&
      posix.normalize(value) === value &&
      value !== '.' &&
      value !== '..' &&
      !value.startsWith('../'),
    { message: 'must be a normalised repo-relative path with "/"' },
  );

const planSuiteSchema = z.strictObject({
  id: suiteIdSchema,
  /** Suite-specific options; the suite validates them itself. */
  options: z.unknown().optional(),
  /** The ground truth the suite scores against; checked before the run. */
  groundTruth: z.strictObject({
    /** Versioned id, e.g. `gt-memory@v1`. */
    id: z.string().min(1),
    paths: z.array(repoRelativePath).min(1),
  }),
});
export type RunnerPlanSuite = z.infer<typeof planSuiteSchema>;

export const runnerPlanSchema = z
  .strictObject({
    schemaId: z.literal(RUNNER_PLAN_SCHEMA_ID),
    cassetteMode: z.enum(['record', 'replay']).default('replay'),
    /** Default: empty cassettes under `<runDir>/cassettes/`. */
    cassettes: z.unknown().optional(),
    fixtures: z.array(z.unknown()).default([]),
    /** Suites the bench host runs (registered in its `HOST_SUITES`). */
    hostSuites: z.array(planSuiteSchema).default([]),
    /** Suites the parent runs inside the launcher window. */
    offlineSuites: z.array(planSuiteSchema).default([]),
  })
  .superRefine((plan, ctx) => {
    // Suite ids name files in one run directory, across both lists.
    const ids = new Set<string>();
    for (const [list, suites] of [
      ['hostSuites', plan.hostSuites],
      ['offlineSuites', plan.offlineSuites],
    ] as const) {
      suites.forEach((suite, index) => {
        if (ids.has(suite.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `suite ${suite.id} is listed twice`,
            path: [list, index, 'id'],
          });
        }
        ids.add(suite.id);
      });
    }
    // Host suites share one database: order constraints (`suite-placement.ts`).
    for (const problem of suitePlacementProblems(
      plan.hostSuites.map((suite) => suite.id),
      hostSuitePlacement,
    )) {
      ctx.addIssue({
        code: 'custom',
        message: problem.message,
        path: ['hostSuites', problem.index, 'id'],
      });
    }
  });
export type RunnerPlan = z.infer<typeof runnerPlanSchema>;

/** Parse and validate plan text. Throws {@link MemorySkillsRunError}. */
export function parseRunnerPlan(text: string, path: string): RunnerPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    throw new MemorySkillsRunError(
      `plan ${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const parsed = runnerPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MemorySkillsRunError(
      `invalid plan ${path}:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
