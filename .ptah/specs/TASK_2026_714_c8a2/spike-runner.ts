import { readFileSync } from 'node:fs';
import { parseOptions, runHarness } from 'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/tools/evidence-harness';

const all = JSON.parse(
  readFileSync(
    'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/tools/evidence-cases.json',
    'utf8',
  ),
);
// User budget: 14 total, 2 used, 12 remain; one run stays within TURN_CAP 8.
const cases = all;
const cost = cases.reduce((sum: number, item: { turnCost: number }) => sum + item.turnCost, 0);
if (cost > 8) throw new Error(`planned turns ${cost} > 8`);
process.stdout.write(`runner: ${cases.length} cases, planned turns ${cost}\n`);
void runHarness(parseOptions(process.argv.slice(2)), cases).catch(() => {
  process.stderr.write('Evidence harness failed; details withheld.\n');
  process.exitCode = 1;
});
