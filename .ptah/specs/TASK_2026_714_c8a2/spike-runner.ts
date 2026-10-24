import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseOptions,
  runHarness,
} from '../../../libs/backend/codex-runtime/tools/evidence-harness';
import {
  parseRoundArgs,
  ROUND_ORDER,
  roundPlan,
} from '../../../libs/backend/codex-runtime/tools/evidence-round-plan';

type EvidenceCase = Parameters<typeof runHarness>[1][number];
const all: EvidenceCase[] = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../../libs/backend/codex-runtime/tools/evidence-cases.json',
    ),
    'utf8',
  ),
);
const selection = parseRoundArgs(process.argv.slice(2));
const cases = ROUND_ORDER[selection.round].map((id) => {
  const found = all.find((item) => item.id === id);
  if (!found) throw new Error(`Case ${id} missing`);
  return found;
});
const plan = roundPlan(cases, selection.priorTurnsUsed);
// The caller records actual turnsConsumed from 7a's JSON artifact, including
// failures/steers, and supplies it for 7b. Never infer use from planned turns.
process.stdout.write(
  `runner ${selection.round}: ${cases.length} cases, planned turns ${plan.plannedTurns}, cap ${plan.cap}, estimated tokens ${plan.estimatedTokens}, budget left ${plan.remaining}, prior turns used ${plan.priorTurnsUsed}\n`,
);
void runHarness(
  parseOptions([...selection.args, '--turn-cap', String(plan.cap)]),
  cases,
).catch(() => {
  process.stderr.write('Evidence harness failed; details withheld.\n');
  process.exitCode = 1;
});
