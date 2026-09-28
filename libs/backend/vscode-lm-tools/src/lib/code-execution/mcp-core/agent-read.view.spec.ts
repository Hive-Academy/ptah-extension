/**
 * `renderAgentRead` — the budgeted `ptah_agent_read` / `agent_read` answer
 * (TASK_2026_559 Batch 13 and its reviews r1-r2). The end-to-end budget and
 * spool cases live with the two transports (`protocol-dispatcher.spec.ts`,
 * `stdio-mcp-server.service.spec.ts`); these pin the rendering rules. The
 * spool here is an in-memory fake: nothing touches the disk.
 */

import type { AgentOutput } from '@ptah-extension/shared';
import { fitsBudget } from '@ptah-extension/tool-output-reducers';
import { renderAgentRead, type AgentReadSpool } from './agent-read.view';

const BUDGET = { tokens: 2000, chars: 8000 };

function output(overrides: Partial<AgentOutput>): AgentOutput {
  return {
    agentId: 'a1' as AgentOutput['agentId'],
    stdout: '',
    stderr: '',
    lineCount: 0,
    totalLines: 0,
    omittedLines: 0,
    stdoutTotalLines: 0,
    stderrTotalLines: 0,
    truncated: false,
    ...overrides,
  };
}

/** A spool that records what it was given and answers with a fixed path. */
function fakeSpool(): AgentReadSpool & { saved: string[] } {
  const saved: string[] = [];
  const spool = async (text: string) => {
    saved.push(text);
    return { path: `/spool/window-${saved.length}.txt` };
  };
  return Object.assign(spool, { saved });
}

describe('renderAgentRead', () => {
  it('renders both streams in full, with no paging line and no spool, when nothing was left out', async () => {
    const spool = fakeSpool();
    const view = await renderAgentRead(
      output({
        stdout: 'line1\nline2',
        stderr: 'oops',
        stdoutTotalLines: 2,
        stderrTotalLines: 1,
        totalLines: 3,
      }),
      undefined,
      BUDGET,
      spool,
    );
    expect(view.text).toMatch(/Agent Output: a1/);
    expect(view.text).toContain('**Lines:** 3 of 3 | **Truncated:** No');
    expect(view.text).toMatch(/### stdout[\s\S]*line1\nline2/);
    expect(view.text).toMatch(/### stderr[\s\S]*oops/);
    expect(view.text).not.toMatch(/Showing/);
    expect(view.shownLines).toBe(3);
    expect(spool.saved).toEqual([]);
  });

  it('says there is no output yet only when the agent has none', async () => {
    expect(
      (await renderAgentRead(output({}), undefined, BUDGET, fakeSpool())).text,
    ).toMatch(/No output yet/);

    const pastEnd = await renderAgentRead(
      output({ stdoutTotalLines: 5, totalLines: 5, omittedLines: 5 }),
      9,
      BUDGET,
      fakeSpool(),
    );
    expect(pastEnd.text).toContain(
      'Showing no lines of 5 (5 omitted; pass offset/tail to page)',
    );
    expect(pastEnd.text).not.toMatch(/No output yet/);
  });

  it('states the exact tail and forward ranges of a window', async () => {
    const tail = await renderAgentRead(
      output({ stdout: 'l4\nl5\n', stdoutTotalLines: 5, totalLines: 5 }),
      undefined,
      BUDGET,
      fakeSpool(),
    );
    expect(tail.text).toContain('**Lines:** 2 of 5');
    expect(tail.text).toContain(
      'Showing lines 4-5 of 5 (3 omitted; pass offset/tail to page)',
    );
    expect(tail.stdout).toMatchObject({ firstLine: 4, lastLine: 5 });

    const page = await renderAgentRead(
      output({ stdout: 'l2\nl3\n', stdoutTotalLines: 5, totalLines: 5 }),
      1,
      BUDGET,
      fakeSpool(),
    );
    expect(page.text).toContain(
      'Showing lines 2-3 of 5 (3 omitted; pass offset/tail to page)',
    );
  });

  // Review r1 S2: no combined interval across the two streams.
  it('states each stream’s own range when both have output', async () => {
    const view = await renderAgentRead(
      output({
        stdout: 'o101\no102\n',
        stderr: 'e101\ne102\n',
        stdoutTotalLines: 300,
        stderrTotalLines: 300,
        totalLines: 600,
      }),
      100,
      BUDGET,
      fakeSpool(),
    );
    expect(view.text).toMatch(
      /### stdout\n+Showing lines 101-102 of 300 \(298 omitted; pass offset\/tail to page\)/,
    );
    expect(view.text).toMatch(
      /### stderr\n+Showing lines 101-102 of 300 \(298 omitted; pass offset\/tail to page\)/,
    );
    expect(view.text).not.toMatch(/of 600 \(/);
    expect(view.text).toContain('**Lines:** 4 of 600');
  });

  // Review r1 B1 / r2 R2-S1: a tail keeps the newest lines that fit, in both
  // streams, and each narrowed window is spooled whole.
  it('keeps the newest lines of each stream when the window is over budget, and spools both windows', async () => {
    const long = (tag: string, n: number) =>
      Array.from(
        { length: n },
        (_, i) => `[${tag}${i + 1}] ${'x'.repeat(190)}`,
      ).join('\n') + '\n';
    const spool = fakeSpool();
    const stdout = long('O', 200);
    const stderr = long('E', 200);
    const view = await renderAgentRead(
      output({
        stdout,
        stderr,
        stdoutTotalLines: 200,
        stderrTotalLines: 200,
        totalLines: 400,
      }),
      undefined,
      BUDGET,
      spool,
    );
    expect(fitsBudget(view.text, BUDGET)).toBe(true);
    expect(view.text).toContain('[O200]');
    expect(view.text).toContain('[E200]');
    const { firstLine } = view.stdout;
    expect(firstLine).toBeGreaterThan(1);
    expect(view.text).toContain(
      `Showing lines ${firstLine}-200 of 200 (${firstLine - 1} omitted`,
    );
    expect(view.text).not.toContain(`[O${firstLine - 1}]`);
    expect(spool.saved).toEqual([stdout, stderr]);
    expect(view.text).toContain('Lines 1-200 in full: /spool/window-1.txt');
    expect(view.text).toContain('Lines 1-200 in full: /spool/window-2.txt');
  });

  it('shows the start of an over-long first line of a forward page', async () => {
    const huge = `START ${'y'.repeat(30_000)} END`;
    const view = await renderAgentRead(
      output({ stdout: `${huge}\n`, stdoutTotalLines: 4, totalLines: 4 }),
      2,
      BUDGET,
      fakeSpool(),
    );
    expect(fitsBudget(view.text, BUDGET)).toBe(true);
    expect(view.text).toContain('START');
    expect(view.text).not.toContain(' END');
    expect(view.text).toMatch(
      new RegExp(
        `Showing the first \\d+ of ${huge.length} chars of line 3 of 4 \\(3 other lines omitted`,
      ),
    );
    expect(view.text).toContain('Lines 3-3 in full: /spool/window-1.txt');
    expect(view.stdout.partialLine?.line).toBe(3);
  });

  // Review r2 R2-S2: the huge line is the one clipped, whichever stream holds it.
  it.each(['stdout', 'stderr'] as const)(
    'keeps the other stream’s whole final line when %s holds one huge line',
    async (hugeStream) => {
      const short =
        'FINAL_FAILURE ' + 'summary details; '.repeat(110) + ' OUT_END';
      const huge = 'y'.repeat(30_000) + ' ERR_END';
      const streams =
        hugeStream === 'stderr'
          ? { stdout: `${short}\n`, stderr: `${huge}\n` }
          : { stdout: `${huge}\n`, stderr: `${short}\n` };
      const view = await renderAgentRead(
        output({
          ...streams,
          stdoutTotalLines: 1,
          stderrTotalLines: 1,
          totalLines: 2,
        }),
        undefined,
        BUDGET,
        fakeSpool(),
      );
      expect(fitsBudget(view.text, BUDGET)).toBe(true);
      expect(view.text).toContain(short);
      expect(view.text).toContain('ERR_END');
      const clipped = view[hugeStream];
      const kept = view[hugeStream === 'stdout' ? 'stderr' : 'stdout'];
      expect(kept).toMatchObject({ shownLines: 1, firstLine: 1, lastLine: 1 });
      expect(clipped.partialLine?.totalChars).toBe(huge.length);
      expect(clipped.partialLine?.shownChars).toBeGreaterThan(512);
    },
  );

  it('says so when the window could not be saved', async () => {
    const view = await renderAgentRead(
      output({
        stdout: `${'z'.repeat(20_000)}\n`,
        stdoutTotalLines: 1,
        totalLines: 1,
      }),
      undefined,
      BUDGET,
      async () => ({ failure: 'EACCES' }),
    );
    expect(fitsBudget(view.text, BUDGET)).toBe(true);
    expect(view.text).toContain(
      'Lines 1-1 could not be saved in full (EACCES)',
    );
    expect(view.stdout.spooled).toEqual({ failure: 'EACCES' });
  });
});
