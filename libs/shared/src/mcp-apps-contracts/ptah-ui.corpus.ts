/** Canonical valid ptah-ui blocks used as parser, rendering, and authoring examples. */
export interface PtahUiCorpusCase {
  readonly name: string;
  readonly body: string;
  readonly purpose: string;
  /**
   * The task whose grammar introduced the case. `610` cases are the released
   * flat grammar and must convert unchanged except `catalogVersion` (R3.1).
   */
  readonly release: 610 | 623;
  /**
   * Set when the case is authored as a `ptah-ui display <id>` fence (R2.1);
   * absent for an inline `ptah-ui` fence.
   */
  readonly displayId?: string;
}

export const PTAH_UI_CORPUS: readonly PtahUiCorpusCase[] = [
  {
    name: 'turn-summary-sources-crlf',
    body: 'title Release readiness\r\nstats\r\n  Files changed | $diff.files\r\n  Tests passed | $tests.passed\r\n  Prompt cost | $usage.cost\r\n  Quoted budget | \\$5\r\n',
    purpose:
      'A compact turn summary with source scalars, CRLF line endings, and an escaped leading dollar.',
    release: 610,
  },
  {
    name: 'literal-table-escapes-unicode',
    body: 'title Migration notes\ntable\n  Check | Detail | Owner\n  Schema \\| contract | \\\\ | Priya\n  Price | $5 today | équipe\n  Empty detail |  | 東京\n',
    purpose:
      'A literal table covering escaped pipe and backslash, an empty cell, a literal mid-cell dollar, and Unicode.',
    release: 610,
  },
  {
    name: 'changed-files-columns',
    body: 'title Files prepared for review\ntable $diff\n  cols path | additions | deletions\n',
    purpose: 'A source table with an explicit compact column selection.',
    release: 610,
  },
  {
    name: 'test-run-list',
    body: 'title Verification runs\nlist $tests\n',
    purpose: 'A source-backed list of test commands and outcomes.',
    release: 610,
  },
  {
    name: 'coverage-trend-chart',
    body: 'title Coverage trend\nchart line Coverage by run\n  Baseline | 72.4\n  Parser | 78.1\n  Pipeline | 84.6\n',
    purpose: 'A line chart with realistic numeric progress points.',
    release: 610,
  },
  {
    name: 'release-checklist-mixed',
    body: 'title Release checklist\nstats\n  Reviewers | 2\n  Risk | low\ntable\n  Area | Status\n  Parser | ready\n  Renderer | queued\nlist\n  - Run the focused shared tests\n  - Attach the compactness report\nchart bar Completed checks\n  Draft | 1\n  Verified | 3\n',
    purpose:
      'A mixed agent update using title, stats, literal table, literal list, and bar chart.',
    release: 610,
  },

  // R8.4: one case per new container (R3.2).
  {
    name: 'container-row-badges',
    body: 'title Review status\nrow\n  badge ok Parser ready\n  badge warn Renderer pending\n  badge neutral Docs queued\n',
    purpose: 'A horizontal row of status badges.',
    release: 623,
  },
  {
    name: 'container-col-note-progress',
    body: 'col\n  note info Two checks remain before release\n  progress Release checklist | 60\n',
    purpose: 'A vertical column stacking a note above a progress bar.',
    release: 623,
  },
  {
    name: 'container-grid-stats',
    body: 'title Session totals\ngrid 2\n  stats\n    Files changed | $diff.files\n    Tests passed | $tests.passed\n  stats\n    Prompt cost | $usage.cost\n    Duration | $usage.duration\n',
    purpose: 'A two-column grid of source-backed stats.',
    release: 623,
  },
  {
    name: 'container-card-avatar',
    body: 'card Release owner\n  avatar Priya Raman | Release manager\n  list\n    - Approves the changelog\n    - Tags the build\n',
    purpose: 'A titled card holding an avatar and a literal list.',
    release: 623,
  },
  {
    name: 'container-section-table',
    body: 'section Changed files\n  table $diff\n    cols path | additions | deletions\n',
    purpose: 'A titled section wrapping a source table.',
    release: 623,
  },
  {
    name: 'container-accordion-tests',
    body: 'accordion Test runs\n  list $tests\n',
    purpose: 'A collapsed-by-default accordion holding the test-run list.',
    release: 623,
  },

  // R8.4: one case per new atom (R3, R4).
  {
    name: 'atom-note-tones',
    body: 'note ok Migration applied cleanly\nnote warn Cache warm-up is slower than usual\nnote error Two snapshot tests fail on Windows\n',
    purpose: 'Notes in the ok, warn and error tones.',
    release: 623,
  },
  {
    name: 'atom-progress-tones',
    body: 'progress Coverage target | 84.6 | ok\nprogress Bundle budget | 97.5 | warn\nprogress Migration | 0\n',
    purpose: 'Progress bars with an explicit tone, a decimal value and zero.',
    release: 623,
  },
  {
    name: 'atom-badge-tones',
    body: 'badge neutral Draft\nbadge info In review\nbadge error Blocked\n',
    purpose: 'Badges in the neutral, info and error tones.',
    release: 623,
  },
  {
    name: 'atom-avatar',
    body: 'avatar Priya Raman | Release manager\navatar Codex\n',
    purpose: 'An avatar with a subtitle and one with a name only.',
    release: 623,
  },
  {
    name: 'stat-trend-spark',
    body: 'title Service health\nstats\n  Latency p95 | 182 ms | -12% good | 240 221 198 182\n  Error rate | 0.4% | +0.1 bad\n  Throughput | 1.2k rps |  | 0.9 1.0 1.2\n',
    purpose:
      'Statlines with a trend and spark, a trend alone, and a spark after an empty trend.',
    release: 623,
  },

  // R8.4: one mixed nested case.
  {
    name: 'mixed-nested-release',
    body: 'title Release overview\ngrid 2\n  card Quality\n    stats\n      Coverage | 84.6% | +6.2% good | 72.4 78.1 84.6\n      Open bugs | 3 | -2 good\n  card Owner\n    avatar Priya Raman | Release manager\n    badge ok On track\nsection Checks\n  accordion Test runs\n    list $tests\n  accordion Changed files\n    table $diff\n      cols path | additions | deletions\nnote warn Renderer review is still open\n',
    purpose:
      'Grid, card, section and accordion nested three deep with stats, atoms and source rows.',
    release: 623,
  },

  // R8.3 worked examples published by the ptah-surface-authoring skill (DOC1).
  {
    name: 'skill-subagent-usage-dashboard',
    body: 'title Subagent usage\ngrid 2\n  stats\n    Agents | $agents.total\n    Running | $agents.running\n  stats\n    Tokens | $agents.tokens\n    Cost | $agents.cost\ntable $agents\n  cols name | status | tokens | cost | duration\n',
    purpose:
      'Skill example: a grid of `$agents` scalars above the per-agent table for this turn.',
    release: 623,
    displayId: 'subagent-usage',
  },
  {
    name: 'skill-id-update-first',
    body: 'title Build progress\nprogress Subagents finished | 40 | info\nstats\n  Completed | $agents.completed\n  Failed | $agents.failed\n',
    purpose:
      'Skill example, first block: a display block that a later block with the same id replaces.',
    release: 623,
    displayId: 'build-progress',
  },
  {
    name: 'skill-id-update-second',
    body: 'title Build progress\nprogress Subagents finished | 100 | ok\nstats\n  Completed | $agents.completed\n  Failed | $agents.failed\nnote ok All subagents finished\n',
    purpose:
      'Skill example, update: the same display id re-sent with new values replaces the first block.',
    release: 623,
    displayId: 'build-progress',
  },
  {
    name: 'skill-cli-tools-usage-context',
    body: 'title CLI tools\nrow\n  table $agents session\n    cols name | status | tokens | context\n  table $limits\n',
    purpose:
      'Skill example for "a list of CLI tools with the usage and context stats": session agents beside lane plan limits. CLI context reads "unavailable" today.',
    release: 623,
    displayId: 'cli-tools',
  },
];

/** The complete fence an agent writes for a corpus case, closing line included. */
export function ptahUiCorpusFence(entry: PtahUiCorpusCase): string {
  const opener =
    entry.displayId === undefined
      ? '```ptah-ui'
      : `\`\`\`ptah-ui display ${entry.displayId}`;
  return `${opener}\n${entry.body}\`\`\``;
}
