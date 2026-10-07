/**
 * The plan the memory-skills bench host executes (benchmark-design.md 6.1,
 * R-X2 step 2). The runner parent writes it as JSON into the run directory and
 * passes its absolute path in `PTAH_BENCH_MEMORY_SKILLS_PLAN`; the launcher's
 * `isolatedEnv` spreads the parent environment, so the child inherits it.
 *
 * Every path the host touches outside its isolated home comes from this plan,
 * resolved by the parent: the child's `HOME`, `USERPROFILE` and
 * `LOCALAPPDATA` point at the temp home, so it cannot resolve the bench data
 * folder or the real home itself (`bench-data.ts` header). The plan therefore
 * carries `benchDataDir` (from `resolveBenchDataDir()`) and `realHome`, whose
 * `.ptah` no path in the plan may name.
 *
 * Lexical rules are checked here; the filesystem rules (existence, symlinks,
 * junctions, sidecars) are checked by `fixture-seeder.ts` when it copies.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, posix, win32 } from 'node:path';

import { z } from 'zod';

import { isPathInside, isSamePath } from '../../bench-data';
import type { CuratorFaultMode } from '../doubles/recorded-curator-llm';

/** Env var naming the absolute path of the plan JSON. */
export const MEMORY_SKILLS_PLAN_ENV = 'PTAH_BENCH_MEMORY_SKILLS_PLAN';
export const MEMORY_SKILLS_PLAN_SCHEMA_ID = '620.host-plan.v1';

const CURATOR_FAULT_MODES = [
  'throw',
  'zero-drafts',
  'timeout',
  'stalled',
] as const satisfies readonly CuratorFaultMode[];

const nonEmpty = z.string().min(1);
const absolutePath = nonEmpty.refine((value) => isAbsolute(value), {
  message: 'must be an absolute path',
});

/** Relative to the isolated home; no absolute path, no `..` segment. */
const homeRelativeTarget = nonEmpty.refine(
  (value) => {
    const slashed = value.replace(/\\/g, '/');
    if (posix.isAbsolute(slashed) || /^[A-Za-z]:/.test(slashed)) return false;
    const normalised = posix.normalize(slashed);
    return (
      normalised !== '.' && normalised !== '..' && !normalised.startsWith('../')
    );
  },
  { message: 'must be a path relative to the isolated home without ".."' },
);

const cassetteSchema = z.strictObject({
  /** Cassette JSONL: read in replay, written in record. */
  path: absolutePath,
  /** Model id the double writes into every recorded entry. */
  model: nonEmpty,
});

const curatorCassetteSchema = cassetteSchema.extend({
  /** Replay-only fault injection, keyed by cassette key (liveness suites). */
  faults: z.record(nonEmpty, z.enum(CURATOR_FAULT_MODES)).optional(),
});

const fixtureSchema = z.discriminatedUnion('kind', [
  /** A SQLite file copied to the isolated `PTAH_DB_PATH`. */
  z.strictObject({ kind: z.literal('database'), source: absolutePath }),
  z.strictObject({
    kind: z.literal('file'),
    source: absolutePath,
    target: homeRelativeTarget,
  }),
  z.strictObject({
    kind: z.literal('directory'),
    source: absolutePath,
    target: homeRelativeTarget,
  }),
]);
export type MemorySkillsFixture = z.infer<typeof fixtureSchema>;

const suiteEntrySchema = z.strictObject({
  id: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9.-]*$/,
      'suite id: lower-case letters, digits, "." and "-"',
    ),
  /** Suite-specific options; the suite validates them itself. */
  options: z.unknown().optional(),
});
export type MemorySkillsPlanSuite = z.infer<typeof suiteEntrySchema>;

function targetKey(target: string, platform: NodeJS.Platform): string {
  const normalised = posix.normalize(target.replace(/\\/g, '/'));
  const trimmed = normalised.replace(/\/+$/, '');
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/** Plan schema for a platform (path case folding); the default uses this one. */
export function createMemorySkillsPlanSchema(
  platform: NodeJS.Platform = process.platform,
) {
  return z
    .strictObject({
      schemaId: z.literal(MEMORY_SKILLS_PLAN_SCHEMA_ID),
      runId: z
        .string()
        .regex(
          /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
          'run id: letters, digits, ".", "_" and "-"',
        ),
      /** The parent's `resolveBenchDataDir()` result. */
      benchDataDir: absolutePath,
      /** Per-run artefact directory, strictly inside `benchDataDir`. */
      runDir: absolutePath,
      /** The user's real home; its `.ptah` is off limits to every plan path. */
      realHome: absolutePath,
      /** Committed synthetic fixtures (`tools/mcp-bench/fixtures/memory-skills`). */
      committedFixturesDir: absolutePath.optional(),
      cassetteMode: z.enum(['record', 'replay']),
      /** CI run: replay only, and suite execution runs under the net recorder. */
      ci: z.boolean(),
      cassettes: z.strictObject({
        curator: curatorCassetteSchema,
        laneRunner: cassetteSchema,
      }),
      fixtures: z.array(fixtureSchema),
      suites: z.array(suiteEntrySchema),
    })
    .superRefine((plan, ctx) => {
      const issue = (message: string, path: (string | number)[]): void => {
        ctx.addIssue({ code: 'custom', message, path });
      };
      const realPtah = (platform === 'win32' ? win32 : posix).join(
        plan.realHome,
        '.ptah',
      );
      const underRealPtah = (path: string): boolean =>
        isSamePath(path, realPtah, platform) ||
        isPathInside(path, realPtah, platform);
      const allowedRoots = [plan.benchDataDir];
      if (plan.committedFixturesDir !== undefined) {
        allowedRoots.push(plan.committedFixturesDir);
      }
      const insideAllowedRoot = (path: string): boolean =>
        allowedRoots.some((root) => isPathInside(path, root, platform));

      if (plan.ci && plan.cassetteMode !== 'replay') {
        issue('a CI plan must use cassetteMode "replay"', ['cassetteMode']);
      }
      if (underRealPtah(plan.benchDataDir)) {
        issue(`benchDataDir lies in the real ${realPtah}`, ['benchDataDir']);
      }
      if (
        plan.committedFixturesDir !== undefined &&
        underRealPtah(plan.committedFixturesDir)
      ) {
        issue(`committedFixturesDir lies in the real ${realPtah}`, [
          'committedFixturesDir',
        ]);
      }
      if (!isPathInside(plan.runDir, plan.benchDataDir, platform)) {
        issue('runDir must lie strictly inside benchDataDir', ['runDir']);
      }

      const checkSource = (path: string, at: (string | number)[]): void => {
        if (underRealPtah(path)) {
          issue(`${path} lies in the real ${realPtah}`, at);
        } else if (!insideAllowedRoot(path)) {
          issue(`${path} is outside benchDataDir and committedFixturesDir`, at);
        }
      };
      checkSource(plan.cassettes.curator.path, [
        'cassettes',
        'curator',
        'path',
      ]);
      checkSource(plan.cassettes.laneRunner.path, [
        'cassettes',
        'laneRunner',
        'path',
      ]);
      if (
        isSamePath(
          plan.cassettes.curator.path,
          plan.cassettes.laneRunner.path,
          platform,
        )
      ) {
        issue('the curator and lane-runner cassettes must be different files', [
          'cassettes',
        ]);
      }
      if (plan.cassetteMode === 'record' && plan.cassettes.curator.faults) {
        issue('curator faults are replay-only', ['cassettes', 'curator']);
      }
      // Record mode writes the cassettes: never into the repository tree.
      const committedRoot = plan.committedFixturesDir;
      if (plan.cassetteMode === 'record' && committedRoot !== undefined) {
        for (const which of ['curator', 'laneRunner'] as const) {
          if (
            isPathInside(plan.cassettes[which].path, committedRoot, platform)
          ) {
            issue(
              'record mode writes cassettes; a record cassette must lie in benchDataDir, not committedFixturesDir',
              ['cassettes', which, 'path'],
            );
          }
        }
      }

      let databases = 0;
      const targets = new Map<string, number>();
      plan.fixtures.forEach((fixture, index) => {
        checkSource(fixture.source, ['fixtures', index, 'source']);
        if (fixture.kind === 'database') {
          databases += 1;
          if (databases > 1) {
            issue('at most one database fixture', ['fixtures', index]);
          }
          return;
        }
        const key = targetKey(fixture.target, platform);
        const first = targets.get(key);
        if (first !== undefined) {
          issue(`target ${fixture.target} repeats fixture ${first}`, [
            'fixtures',
            index,
            'target',
          ]);
        } else {
          targets.set(key, index);
        }
      });
      // A target inside another target's tree would merge two fixtures.
      const keys = [...targets.keys()];
      for (const left of keys) {
        for (const right of keys) {
          if (left !== right && right.startsWith(`${left}/`)) {
            issue(`target ${right} lies inside target ${left}`, ['fixtures']);
          }
        }
      }

      const ids = new Set<string>();
      plan.suites.forEach((suite, index) => {
        if (ids.has(suite.id)) {
          issue(`suite ${suite.id} is listed twice`, ['suites', index, 'id']);
        }
        ids.add(suite.id);
      });
    });
}

export type MemorySkillsPlan = z.infer<
  ReturnType<typeof createMemorySkillsPlanSchema>
>;

/** The plan could not be read, parsed or validated; the host refuses to boot. */
export class MemorySkillsPlanError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MemorySkillsPlanError';
  }
}

export interface LoadPlanOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly readText?: (path: string) => string;
  readonly platform?: NodeJS.Platform;
}

/**
 * Read, parse and validate the plan named by `PTAH_BENCH_MEMORY_SKILLS_PLAN`.
 * The plan file itself must lie inside the plan's `benchDataDir`.
 * Throws {@link MemorySkillsPlanError}.
 */
export function loadMemorySkillsPlan(
  options: LoadPlanOptions = {},
): MemorySkillsPlan {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const readText =
    options.readText ?? ((path: string) => readFileSync(path, 'utf8'));

  const planPath = env[MEMORY_SKILLS_PLAN_ENV];
  if (!planPath) {
    throw new MemorySkillsPlanError(`${MEMORY_SKILLS_PLAN_ENV} is not set`);
  }
  if (!isAbsolute(planPath)) {
    throw new MemorySkillsPlanError(
      `${MEMORY_SKILLS_PLAN_ENV} must be an absolute path, got ${planPath}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readText(planPath));
  } catch (error: unknown) {
    throw new MemorySkillsPlanError(
      `cannot read plan ${planPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const parsed = createMemorySkillsPlanSchema(platform).safeParse(raw);
  if (!parsed.success) {
    throw new MemorySkillsPlanError(
      `invalid plan ${planPath}:\n${z.prettifyError(parsed.error)}`,
    );
  }
  if (!isPathInside(planPath, parsed.data.benchDataDir, platform)) {
    throw new MemorySkillsPlanError(
      `plan ${planPath} must lie inside its benchDataDir ${parsed.data.benchDataDir}`,
    );
  }
  return parsed.data;
}
