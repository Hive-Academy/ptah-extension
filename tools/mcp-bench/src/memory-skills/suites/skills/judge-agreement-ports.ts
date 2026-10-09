/**
 * Host adapter of the judge agreement suites: resolves the product's judge,
 * panel, candidate store and settings from the bench host's booted container
 * (benchmark-design.md 4.3).
 *
 * HOST-ONLY: this module value-imports the `@ptah-extension/skill-synthesis`
 * barrel (tsyringe, vscode-core), so it belongs in `HOST_ONLY_MODULES` of
 * `../../host-only-imports.spec.ts` and only the host entry wires it
 * (`createJudgeAgreementSuites({ resolveServices: resolveJudgeServices })`).
 *
 * The judge and the panel are built in a CHILD container that differs from
 * the host's in exactly one registration: `LANE_RUNNER_SERVICE` is the
 * pass-through {@link LaneTap} around the lane runner the host installed. The
 * classes, their constructor wiring (`di/register.ts:141-143`, `:228-230`),
 * the candidate store, the workspace settings and the embedder all come from
 * the host container unchanged, and the host's own singletons are left alone,
 * so no later suite sees the tap.
 */

import {
  JudgePanelService,
  SKILL_SYNTHESIS_TOKENS,
  SkillJudgeService,
  type SkillCandidateStore,
  type SkillSynthesisService,
} from '@ptah-extension/skill-synthesis';

import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import type { JudgeServices } from './judge-agreement.suite';
import { LaneTap } from './judge-lane-tap';

const PANEL_TOKEN = Symbol('620.judge-agreement.panel');

export function resolveJudgeServices(
  context: MemorySkillsHostSuiteContext,
): JudgeServices {
  const { container, doubles } = context;
  const installed = container.resolve<unknown>(
    SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE,
  );
  if (installed !== doubles.laneRunner) {
    throw new Error(
      'LANE_RUNNER_SERVICE does not resolve to the installed record/replay double; the judge run would bypass it',
    );
  }
  const tap = new LaneTap(doubles.laneRunner);
  const child = container.createChildContainer();
  child.register(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE, {
    useValue: tap,
  });
  child.register(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE, {
    useClass: SkillJudgeService,
  });
  child.register(PANEL_TOKEN, { useClass: JudgePanelService });
  return {
    judge: child.resolve<SkillJudgeService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE,
    ),
    panel: child.resolve<JudgePanelService>(PANEL_TOKEN),
    store: container.resolve<SkillCandidateStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE,
    ),
    settings: container
      .resolve<SkillSynthesisService>(
        SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
      )
      .readSettings(),
    tap,
    laneMode: doubles.mode,
  };
}
