/**
 * The runner plan (`620.runner-plan.v1`): what a user hands
 * `bench-memory-skills --plan`. Paths the parent resolves (bench data folder,
 * run directory, real home, committed fixtures) are filled in by the runner
 * when it derives the host plan; `cassettes` and `fixtures` are validated by
 * the host plan schema (`host/plan.schema.ts`) at that point.
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { z } from 'zod';

import {
  hostSuitePlacement,
  suitePlacementProblems,
} from '../host/suite-placement';
import { funnelPlanProblems } from '../suites/skills/funnel.suite';
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

/**
 * The one product setting whose name contains a secret-like word. It is the
 * Codex OAuth token URL (`codex-auth.service.ts` reads
 * `provider.openai-codex.oauthTokenEndpoint` under section `ptah`). Record
 * mode overwrites it with an unreachable loopback address.
 */
export const OAUTH_TOKEN_ENDPOINT_SETTING =
  'provider.openai-codex.oauthTokenEndpoint';

/** Names that must not ride along in a plan: credentials, not configuration. */
const SECRET_SETTING_KEY = /token|secret|key|password|auth/i;

const settingValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * `ptah.`-relative product settings. Keys are the configuration key under
 * section `ptah` (for example `memory.curatorProvider`). Secret-like names
 * are refused except {@link OAUTH_TOKEN_ENDPOINT_SETTING}.
 */
export const productSettingsSchema = z
  .record(z.string(), settingValueSchema)
  .superRefine((settings, ctx) => {
    for (const key of Object.keys(settings)) {
      if (key === OAUTH_TOKEN_ENDPOINT_SETTING) continue;
      if (SECRET_SETTING_KEY.test(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `setting ${key} looks like a secret and is not allowed`,
          path: [key],
        });
      }
    }
  });
export type ProductSettings = z.infer<typeof productSettingsSchema>;

/** sha256 of sorted-key JSON. Completion metadata stores this, never values. */
export function canonicalProductSettingsSha256(
  settings: Readonly<ProductSettings>,
): string {
  const sorted: ProductSettings = {};
  for (const key of Object.keys(settings).sort()) {
    sorted[key] = settings[key];
  }
  return createHash('sha256')
    .update(JSON.stringify(sorted), 'utf8')
    .digest('hex');
}

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
    /** Product settings written under section `ptah` in the isolated config. */
    settings: productSettingsSchema.optional(),
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
    // The funnel stages share one memoised pass: their shared options agree.
    for (const message of funnelPlanProblems(plan.hostSuites)) {
      ctx.addIssue({ code: 'custom', message, path: ['hostSuites'] });
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
