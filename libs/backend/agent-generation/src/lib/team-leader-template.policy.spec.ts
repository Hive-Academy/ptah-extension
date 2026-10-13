import { readFileSync } from 'fs';
import { join } from 'path';

const template = readFileSync(
  join(__dirname, '..', '..', 'templates', 'agents', 'team-leader.template.md'),
  'utf8',
);
const decomposition = template.split('## Mode 1 — Decomposition')[1]?.split('## Mode 2 — Verify and commit')[0];

describe('team-leader batch policy', () => {
  it('defaults bounded sequential and cross-file batches to capable live CLI lanes', () => {
    expect(decomposition).toContain('Recommend `CLI lane` for every bounded batch by default');
    expect(decomposition).toContain('sequential coupled tasks in');
    expect(decomposition).toContain('sequential cross-file work');
    expect(decomposition).toContain('orchestrator resolves the live lane rows at spawn time');
    expect(decomposition).toContain('parallel only when every task writes to different files');
  });

  it('keeps the exact batch cap', () => {
    expect(decomposition).toContain(
      'At most 6 files across at most 2 libraries/projects per batch, with one scoped verification command.',
    );
  });

  it('defines the required executor, fallback, and review schema in batches.md', () => {
    for (const field of [
      '- Recommended executor: CLI lane [capability]',
      '- Execution mode: sequential | parallel',
      '- Fallback order: other family same capability -> same family other provider/model -> subagent',
      '- Subagent reason: <specific reason | N/A>',
      '- Review family: different from implementer | exception reason',
    ]) {
      expect(decomposition).toContain(field);
    }
  });

  it('requires a specific reason for a subagent recommendation', () => {
    expect(decomposition).toContain('Recommend a subagent only with a specific reason:');
    expect(decomposition).toContain('the needed capability is missing from live lanes');
    expect(decomposition).toContain('interaction, visual work or');
    expect(decomposition).toContain('the user pinned a subagent');
    expect(decomposition).toContain('eligible lanes are exhausted');
    expect(decomposition).toContain('Put that reason in `Subagent reason`');
  });
});
