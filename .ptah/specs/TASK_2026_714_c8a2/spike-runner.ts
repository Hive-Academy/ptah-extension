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
// Run 6g. User budget: 20 total, 9 used, 11 remain; one run is capped at 8 (TURN_CAP). Proved and
// dropped: ask-command-accept, compaction (run 6e), ask-command-deny (run 6f). ask-command-edit runs
// first so a steer-created turn can only skip the last case. ask-read-rule runs last because an
// "unverified" result stops every later case. The harness enforces the cap through --turn-cap.
const REMAINING = 11;
const CAP = Math.min(REMAINING, 8);
const order = [
  'schema-handshake',
  'modified-input-schema',
  'ask-command-edit',
  'file-change-accept',
  'plan-read-only',
  'auto-edit-boundary',
  'yolo-interrupt',
  'mcp-approval',
  'ask-read-rule',
];
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
