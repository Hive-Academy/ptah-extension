import { encode } from 'gpt-tokenizer';
import {
  parsePtahUi,
  segmentPtahUi,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  PTAH_UI_HINT,
  PTAH_UI_HINT_CODEX,
  routeSurfaceRequest,
} from './ptah-ui-hint';

/**
 * Every host source the hint must list, in the order it lists them (R8.1),
 * each with one scalar the grammar defines for it (`$usage` has no rows).
 */
const HOST_SOURCE_SCALARS = {
  diff: 'files',
  tests: 'total',
  usage: 'cost',
  agents: 'total',
  limits: 'lanes',
} as const;
const HOST_SOURCES = Object.keys(HOST_SOURCE_SCALARS) as Array<
  keyof typeof HOST_SOURCE_SCALARS
>;

const CLAUDE_PTAH_UI_HINT =
  'Use ```ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron; ```ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests $usage $agents $limits; the host supplies real values—never type them yourself. For a report, dashboard or other visual view of the work, publish one self-contained HTML page with ptah_artifact_publish and describe it in one sentence. Do not answer a report with ptah-ui blocks alone. Load the ptah-surface-authoring skill and any available design or data-visualization skill such as frontend-design or dataviz before publishing.';

describe('PTAH_UI_HINT', () => {
  it('stays within the report-rule token budget', () => {
    expect(encode(PTAH_UI_HINT).length).toBeLessThanOrEqual(220);
  });

  it('keeps the Claude text byte-identical, including the skill sentence', () => {
    expect(PTAH_UI_HINT).toBe(CLAUDE_PTAH_UI_HINT);
    expect(PTAH_UI_HINT).toContain(
      'Load the ptah-surface-authoring skill and any available design or data-visualization skill such as frontend-design or dataviz before publishing.',
    );
    expect(PTAH_UI_HINT).toContain('ptah_artifact_publish');
  });

  it('points to the on-demand skill without advertising deferred elements', () => {
    expect(PTAH_UI_HINT).toContain('ptah-surface-authoring');
    expect(PTAH_UI_HINT).not.toMatch(/note/i);
  });

  it('says that the host supplies values for every available source', () => {
    expect(PTAH_UI_HINT).toContain('the host supplies');
    expect(PTAH_UI_HINT).toContain(
      HOST_SOURCES.map((source) => `$${source}`).join(' '),
    );
  });

  it('names the display target and the id-update rule', () => {
    expect(PTAH_UI_HINT).toContain('```ptah-ui display [id]');
    expect(PTAH_UI_HINT).toContain('reusing an id updates it in place');
  });

  it('keeps the session scope and row fields in the skill only (R8.3)', () => {
    expect(PTAH_UI_HINT).not.toMatch(/\bsession\b/);
    expect(PTAH_UI_HINT).not.toMatch(/\bcontext\b/);
  });

  it('future-fence guard: every ptah-ui fence the hint may contain parses (it contains none today)', () => {
    const examples = Array.from(
      PTAH_UI_HINT.matchAll(/```ptah-ui(?: display(?: \S+)?)?\n([\s\S]*?)\n```/g),
      (match) => match[1],
    );

    for (const example of examples) {
      expect(parsePtahUi(example).ok).toBe(true);
    }
  });

  it('component syntax coverage: the named display [id] opener segments as a display fence and each listed source parses as a stat value', () => {
    // The hint carries no example because R8.1 does not require one and R8.3
    // assigns worked examples to the ptah-surface-authoring skill, so the forms
    // it names are checked instead: the display opener with a concrete id, and
    // each listed source as a stat value.
    const opener = /```ptah-ui display \[id\]/.exec(PTAH_UI_HINT)?.[0];
    expect(opener).toBeDefined();
    const fence = `${(opener ?? '').replace('[id]', 'turn-stats')}\nlist $tests\n\`\`\``;
    const [segment] = segmentPtahUi(fence);
    expect(segment).toMatchObject({
      kind: 'fence',
      target: 'display',
      displayId: 'turn-stats',
    });

    for (const source of HOST_SOURCES) {
      const body = `stats\n  Value | $${source}.${HOST_SOURCE_SCALARS[source]}`;
      expect({ body, ok: parsePtahUi(body).ok }).toEqual({ body, ok: true });
    }
  });
});

describe('PTAH_UI_HINT_CODEX', () => {
  it('keeps the shared sentences and drops the skill-loading sentence', () => {
    expect(PTAH_UI_HINT.startsWith(PTAH_UI_HINT_CODEX)).toBe(true);
    expect(PTAH_UI_HINT).toBe(
      `${PTAH_UI_HINT_CODEX} Load the ptah-surface-authoring skill and any available design or data-visualization skill such as frontend-design or dataviz before publishing.`,
    );
    expect(PTAH_UI_HINT_CODEX).toContain('ptah_artifact_publish');
    expect(PTAH_UI_HINT_CODEX).not.toContain('ptah-surface-authoring');
    expect(PTAH_UI_HINT_CODEX).not.toContain('skill');
    expect(PTAH_UI_HINT_CODEX).not.toContain('frontend-design');
    expect(PTAH_UI_HINT_CODEX).not.toContain('dataviz');
    expect(encode(PTAH_UI_HINT_CODEX).length).toBeLessThanOrEqual(180);
  });
});

describe('routeSurfaceRequest', () => {
  it.each([
    'make a diagram of the module dependencies',
    'draw a chart of the test results',
    'build a dashboard for my components',
    'chart of test results',
    'diagram showing module dependencies',
    'graph about the test results',
    'plot on module dependencies',
    'visualization with component metrics',
    'can you do it with charts better',
    'visualize my open tasks',
    'make a diagram of the architecture',
    'give me an infographic of this sprint',
    'show a representational view of my work',
    'send me a report of all in-progress tasks',
    'make a dashboard of my work',
  ])('routes visual request %s to a report', prompt => {
    expect(routeSurfaceRequest(prompt, { skillLookup: false }).kind).toBe('report');
  });

  it.each([
    'file a bug report', 'report this error', 'fix the chart component bug',
    'rename the plot variable', 'what does the diagram.ts file do',
    'show me the chart component source', 'create a chart component',
    'fix the graph rendering bug', 'refactor plot.ts',
    'add a test for the diagram module',
    'can you report on the crash',
    'debug a diagram of the module dependencies',
    'lint the chart of the test results',
    'typecheck the dashboard for my components',
    'implement a chart of the test results',
    'write a test for the diagram module',
    'review the code for the chart of results',
    'show me the chart new component source',
    'create a chart.component.html file',
    'Why is the dashboard failing?',
    'the dashboard page is slow',
    'where is the dashboard component',
  ])('keeps nonvisual request %s compact', prompt => {
    expect(routeSurfaceRequest(prompt, { skillLookup: false }).kind).toBe('compact');
  });
  const report = 'send me a report of all in-progress tasks';

  it('routes a report to an HTML artifact and names skills when lookup exists', () => {
    const route = routeSurfaceRequest(report, { skillLookup: true });
    expect(route.kind).toBe('report');
    expect(route.guidance).toContain('ptah-surface-authoring');
    expect(route.guidance).toContain('frontend-design');
    expect(route.guidance).toContain('dataviz');
    expect(route.guidance).toContain('ptah_artifact_publish');
    expect(route.guidance).toContain('Do not answer with ptah-ui blocks alone');
  });

  it('routes a report without naming a skill file when the host cannot look one up', () => {
    const route = routeSurfaceRequest(report, { skillLookup: false });
    expect(route.kind).toBe('report');
    expect(route.guidance).toContain('ptah_artifact_publish');
    expect(route.guidance).not.toContain('skill');
    expect(route.guidance).not.toContain('ptah-surface-authoring');
    expect(route.guidance).not.toContain('frontend-design');
    expect(route.guidance).not.toContain('dataviz');
  });

  it.each([
    'dashboard of open tasks',
    'a visual view of the sprint',
    'representational view of this week',
    'write a weekly report',
    'send me a report of all in-progress tasks',
    'make a dashboard of my work',
  ])('treats %s as a report', (prompt) => {
    expect(routeSurfaceRequest(prompt, { skillLookup: true }).kind).toBe(
      'report',
    );
  });

  it.each([
    'summarize this turn',
    'show the test results',
    'stats for this turn',
    'bug report: login fails',
    'file a bug report',
    'report this error',
    'can you report on the crash',
    'go on',
    '',
  ])('treats %s as a compact ptah-ui summary', (prompt) => {
    const route = routeSurfaceRequest(prompt, { skillLookup: false });
    expect(route.kind).toBe('compact');
    expect(route.guidance).toContain('ptah-ui');
    expect(route.guidance).not.toContain('ptah_artifact_publish');
    expect(route.guidance).not.toContain('skill');
  });
});
