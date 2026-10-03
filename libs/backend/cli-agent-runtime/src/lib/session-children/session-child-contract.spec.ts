import { renderLaneCompletionContract } from '../cli-agents/lane-reporting-contract';
import {
  composeSessionChildPrompt,
  renderSessionChildContract,
  type SessionChildContractInput,
} from './session-child-contract';

const BASE: SessionChildContractInput = {
  parentLabel: 'orchestrator (11111111-2222-4333-8444-555555555555)',
  label: 'parser fix',
  branch: 'feat/parser-fix',
  worktreePath: '/repo/.claude-worktrees/feat-parser-fix-0123456789ab',
  bashAllowlist: ['git status', 'npx nx'],
  denyWindowMs: 60_000,
  taskFolder:
    '/repo/.claude-worktrees/feat-parser-fix-0123456789ab/.ptah/specs/TASK_2026_001',
  deliverables: [
    '/repo/.claude-worktrees/feat-parser-fix-0123456789ab/.ptah/specs/TASK_2026_001/report.md',
  ],
};

describe('renderSessionChildContract', () => {
  it('renders the full contract (snapshot)', () => {
    expect(renderSessionChildContract(BASE)).toMatchInlineSnapshot(`
      "<ptah-session-contract>
      You are child session "parser fix", started by the parent session orchestrator (11111111-2222-4333-8444-555555555555) with ptah_session_start.
      You work on branch feat/parser-fix in the git worktree /repo/.claude-worktrees/feat-parser-fix-0123456789ab. Stay inside that worktree.
      You run unattended in your own tab; the user may also type there. AskUserQuestion and plan mode are unavailable: decide, note the assumption, and continue.
      Report progress, decisions and blockers to the parent with ptah_agent_report. If a report is refused because the parent is not live, repeat its content in your final message of the turn so the parent reads it later.
      You cannot start sessions of your own (ptah_session_start is refused for child sessions).
      Bash commands that start with one of \`git status\`, \`npx nx\` run without asking. Any other command waits for approval in your tab and is denied after 1 minute; prefer the allowed commands.
      Commit your work on this branch only. Never merge, rebase onto, or push another branch, and never remove the worktree: the user owns merge, PR and worktree cleanup.
      Task folder: /repo/.claude-worktrees/feat-parser-fix-0123456789ab/.ptah/specs/TASK_2026_001
      Write every one of these deliverables before you go idle; the parent is told which are missing, empty, or not written by you:
      - /repo/.claude-worktrees/feat-parser-fix-0123456789ab/.ptah/specs/TASK_2026_001/report.md
      </ptah-session-contract>"
    `);
  });

  it('tells the child to repeat refused-report content in its final message', () => {
    expect(renderSessionChildContract(BASE)).toMatch(
      /refused because the parent is not live, repeat its content in your final message/,
    );
  });

  it('renders an empty allowlist, a zero window and no deliverables honestly', () => {
    const text = renderSessionChildContract({
      ...BASE,
      bashAllowlist: [],
      denyWindowMs: 0,
      taskFolder: undefined,
      deliverables: [],
    });
    expect(text).toContain('(none: every Bash command needs approval)');
    expect(text).toContain('denied after no wait (denied at once)');
    expect(text).toContain('No deliverables were declared');
    expect(text).not.toContain('Task folder:');
  });

  it('renders a sub-minute window in seconds', () => {
    expect(
      renderSessionChildContract({ ...BASE, denyWindowMs: 45_500 }),
    ).toContain('denied after 46 seconds');
  });

  it('is a separate text from the lane completion contract (no process-exit wording)', () => {
    const lane = renderLaneCompletionContract({
      deliverables: ['report.md'],
    });
    const session = renderSessionChildContract(BASE);
    expect(lane).toContain('## Before you exit');
    expect(session).not.toContain('Before you exit');
  });
});

describe('composeSessionChildPrompt', () => {
  it('puts the contract before a plain task', () => {
    expect(composeSessionChildPrompt('CONTRACT', '  Fix the parser ')).toBe(
      'CONTRACT\n\nFix the parser',
    );
  });

  it('keeps a slash-command task first so the SDK expands it', () => {
    expect(
      composeSessionChildPrompt('CONTRACT', '/orchestrate TASK_2026_001'),
    ).toBe('/orchestrate TASK_2026_001\n\nCONTRACT');
  });
});
