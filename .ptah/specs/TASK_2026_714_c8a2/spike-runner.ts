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
// Run 6f. User budget: 14 total, 7 used, 7 remain. ask-command-accept and compaction are proved
// (run 6e) and dropped. ask-command-edit runs second so a steer-created turn skips the last case,
// never the edit case. The harness enforces the remaining budget through --turn-cap.
const REMAINING = 7;
const order = [
  'schema-handshake',
  'ask-command-deny',
  'ask-command-edit',
  'modified-input-schema',
  'file-change-accept',
  'plan-read-only',
  'auto-edit-boundary',
  'yolo-interrupt',
  'mcp-approval',
];
const cases = order.map((id) => {
  const found = all.find((item) => item.id === id);
  if (!found) throw new Error(`case ${id} missing`);
  return found;
});
const cost = cases.reduce((sum, item) => sum + item.turnCost, 0);
if (cost > REMAINING) throw new Error(`planned turns ${cost} > ${REMAINING}`);
const args = process.argv.slice(2);
if (args.includes('--turn-cap'))
  throw new Error('runner sets --turn-cap itself');
process.stdout.write(
  `runner: ${cases.length} cases, planned turns ${cost}, cap ${REMAINING}\n`,
);
void runHarness(
  parseOptions([...args, '--turn-cap', String(REMAINING)]),
  cases,
).catch(() => {
  process.stderr.write('Evidence harness failed; details withheld.\n');
  process.exitCode = 1;
});
