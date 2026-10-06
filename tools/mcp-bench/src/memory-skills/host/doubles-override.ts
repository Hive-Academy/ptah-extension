/**
 * Replaces the two model-calling services of the booted container with the
 * record/replay doubles (benchmark-design.md 6.1 R-X2 step 4 and 6.2). Runs in
 * `afterContainerReady`, before the MCP server starts, so no tool call can
 * reach the real adapters first.
 *
 * Only `CURATOR_LLM` and `LANE_RUNNER_SERVICE` are registered; nothing else in
 * the container changes. In replay mode the real adapters are never resolved,
 * so they are never constructed and cannot be reached through the container.
 * In record mode the real adapter is resolved once and wrapped.
 *
 * Residual risk: a consumer singleton constructed before this hook keeps the
 * real adapter it was injected with. The bench boot uses Thoth `oneshot`
 * (`thoth-runtime.ts:129` returns before the memory curator and the skill
 * services are resolved), and in CI the host's net recorder fails the run on
 * any outbound attempt, which a real adapter call would make.
 */

import {
  MEMORY_CONTRACT_TOKENS,
  type ICuratorLLM,
} from '@ptah-extension/memory-contracts';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';

import type { BenchHostContainer } from '../../transport/bench-host-boot';
import { CassetteStore } from '../doubles/cassette-store';
import { RecordedCuratorLlm } from '../doubles/recorded-curator-llm';
import {
  RecordedLaneRunner,
  type LaneRunnerDouble,
} from '../doubles/recorded-lane-runner';
import type { MemorySkillsPlan } from './plan.schema';

export interface InstalledDoubles {
  readonly mode: MemorySkillsPlan['cassetteMode'];
  readonly curator: RecordedCuratorLlm;
  readonly laneRunner: RecordedLaneRunner;
}

export class DoublesOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoublesOverrideError';
  }
}

function resolveReal<T>(
  container: BenchHostContainer,
  token: symbol,
  name: string,
): T {
  if (!container.isRegistered(token, true)) {
    throw new DoublesOverrideError(
      `record mode needs the real ${name}, but it is not registered`,
    );
  }
  return container.resolve<T>(token);
}

/**
 * Register the doubles for `CURATOR_LLM` and `LANE_RUNNER_SERVICE` and verify
 * that the container now resolves exactly them. Throws
 * {@link DoublesOverrideError}; the boot then aborts before MCP starts.
 */
export function installRecordReplayDoubles(
  container: BenchHostContainer,
  plan: Pick<MemorySkillsPlan, 'cassetteMode' | 'cassettes'>,
): InstalledDoubles {
  const mode = plan.cassetteMode;
  const curatorToken = MEMORY_CONTRACT_TOKENS.CURATOR_LLM;
  const laneToken = SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE;

  const curator = new RecordedCuratorLlm({
    store: new CassetteStore({ path: plan.cassettes.curator.path, mode }),
    model: plan.cassettes.curator.model,
    inner:
      mode === 'record'
        ? resolveReal<ICuratorLLM>(container, curatorToken, 'CURATOR_LLM')
        : undefined,
    faults: plan.cassettes.curator.faults,
  });
  const laneRunner = new RecordedLaneRunner({
    store: new CassetteStore({ path: plan.cassettes.laneRunner.path, mode }),
    model: plan.cassettes.laneRunner.model,
    inner:
      mode === 'record'
        ? resolveReal<LaneRunnerDouble>(
            container,
            laneToken,
            'LANE_RUNNER_SERVICE',
          )
        : undefined,
  });

  container.register<ICuratorLLM>(curatorToken, { useValue: curator });
  container.register<LaneRunnerDouble>(laneToken, { useValue: laneRunner });

  if (container.resolve(curatorToken) !== curator) {
    throw new DoublesOverrideError(
      'CURATOR_LLM does not resolve to the record/replay double after the override',
    );
  }
  if (container.resolve(laneToken) !== laneRunner) {
    throw new DoublesOverrideError(
      'LANE_RUNNER_SERVICE does not resolve to the record/replay double after the override',
    );
  }
  return { mode, curator, laneRunner };
}
