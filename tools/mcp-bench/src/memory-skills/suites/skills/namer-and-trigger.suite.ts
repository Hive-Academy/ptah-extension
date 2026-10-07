/**
 * Batch 23: `skill.namer.collisions` and `skill.trigger-eval.human`
 * (benchmark-design.md:83, :100, :290-291).
 *
 * Both are LOCAL HOST suites with placement `any`: they call the real
 * skill-synthesis services (`SkillMdGenerator`, `TriggerEvalService`), whose
 * barrel needs `reflect-metadata` and the `vscode` shim, so they cannot run in
 * the plain runner parent; and neither reads nor writes the host database.
 * Neither calls a model (`modelCalls: 0`).
 *
 * - `skill.namer.collisions` (`namer-collisions.ts`): slug collision rate on
 *   the frozen candidate copy the plan seeds into the isolated home. Local
 *   only: the copy is private user data, so it can never be a CI suite.
 * - `skill.trigger-eval.human` (`trigger-human-eval.ts`): the product's
 *   trigger-eval scoring on human-labelled prompts; `na: ground-truth-absent`
 *   until U4 labels exist.
 *
 * Results are written with `writeSuiteResult` (`runner/suite-result.ts`).
 */

import {
  SKILL_SYNTHESIS_TOKENS,
  SkillMdGenerator,
  type SkillSynthesisService,
} from '@ptah-extension/skill-synthesis';

import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import { writeSuiteResult } from '../../runner/suite-result';
import {
  NAMER_COLLISIONS_SUITE_ID,
  runNamerCollisions,
} from './namer-collisions';
import {
  TRIGGER_EVAL_HUMAN_SUITE_ID,
  runTriggerEvalHuman,
} from './trigger-human-eval';

export { NAMER_COLLISIONS_SUITE_ID } from './namer-collisions';
export { TRIGGER_EVAL_HUMAN_SUITE_ID } from './trigger-human-eval';

/**
 * The real generator, constructed in a child container so the probe never
 * shares state with the container's singleton.
 */
function hostGenerator(
  context: MemorySkillsHostSuiteContext,
): SkillMdGenerator {
  const child = context.container.createChildContainer();
  child.register(SkillMdGenerator, { useClass: SkillMdGenerator });
  return child.resolve(SkillMdGenerator);
}

/**
 * Both suites are local-only (as the judge suites, `judge-agreement.suite.ts`):
 * a `--ci` plan naming one fails loudly before any fixture is read, instead of
 * reading private data or reporting an `na` that looks like a measured run.
 */
function refuseCi(context: MemorySkillsHostSuiteContext, why: string): void {
  if (context.ci) {
    throw new Error(`${why}; it never runs in CI`);
  }
}

export const namerCollisionsSuite: MemorySkillsHostSuite = {
  id: NAMER_COLLISIONS_SUITE_ID,
  async run(context) {
    refuseCi(
      context,
      `${NAMER_COLLISIONS_SUITE_ID} is local-only: it reads the private frozen candidate copy`,
    );
    const { result, cases } = runNamerCollisions({
      home: context.isolation.home,
      options: context.options,
      writer: hostGenerator(context),
    });
    writeSuiteResult(context.runDir, result, cases);
  },
};

export const triggerEvalHumanSuite: MemorySkillsHostSuite = {
  id: TRIGGER_EVAL_HUMAN_SUITE_ID,
  async run(context) {
    refuseCi(
      context,
      `${TRIGGER_EVAL_HUMAN_SUITE_ID} is local-only: it scores human labels with the real embedder`,
    );
    const { result, cases } = await runTriggerEvalHuman({
      home: context.isolation.home,
      options: context.options,
      env: {
        container: context.container,
        // The product's own settings reader; resolved only when labels exist.
        readSettings: () =>
          context.container
            .resolve<SkillSynthesisService>(
              SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
            )
            .readSettings(),
      },
    });
    writeSuiteResult(context.runDir, result, cases);
  },
};

/** Registered in the host entry's `HOST_SUITES`; local runs only. */
export const NAMER_AND_TRIGGER_SUITES: readonly MemorySkillsHostSuite[] = [
  namerCollisionsSuite,
  triggerEvalHumanSuite,
];
