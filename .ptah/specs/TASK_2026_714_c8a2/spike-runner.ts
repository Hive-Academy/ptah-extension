import { readFileSync } from 'node:fs';
import {
  parseOptions,
  runHarness,
} from 'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/tools/evidence-harness';

type EvidenceCase = Parameters<typeof runHarness>[1][number];
const all: EvidenceCase[] = JSON.parse(
  readFileSync(
    'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/tools/evidence-cases.json',
    'utf8',
  ),
);
// Run 6j. User budget: 20 total, 17 used, 3 remain. Observed and dropped: command accept/deny,
// compaction, file change, plan, auto-edit, YOLO (runs 6e-6h), MCP approval (run 6i). Only the
// edit case runs, after Batch 1l (agent-text evidence, per-message stop instruction). 1 planned
// + 1 possible steer turn = cap 2, one turn stays in reserve.
const REMAINING = 3;
const CAP = 2;
const order = ['schema-handshake', 'modified-input-schema', 'ask-command-edit'];
const cases = order.map((id) => {
  const found = all.find((item) => item.id === id);
  if (!found) throw new Error(`case ${id} missing`);
  return found;
});
const cost = cases.reduce((sum, item) => sum + item.turnCost, 0);
if (cost >= CAP)
  throw new Error(
    `planned turns ${cost} leave no slot for a steer turn under cap ${CAP}`,
  );
const args = process.argv.slice(2);
if (args.includes('--turn-cap'))
  throw new Error('runner sets --turn-cap itself');
process.stdout.write(
  `runner: ${cases.length} cases, planned turns ${cost}, cap ${CAP}, budget left ${REMAINING}\n`,
);
void runHarness(
  parseOptions([...args, '--turn-cap', String(CAP)]),
  cases,
).catch(() => {
  process.stderr.write('Evidence harness failed; details withheld.\n');
  process.exitCode = 1;
});
