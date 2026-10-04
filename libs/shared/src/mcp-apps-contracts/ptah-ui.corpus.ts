/** Canonical valid ptah-ui blocks used as parser, rendering, and authoring examples. */
export interface PtahUiCorpusCase {
  readonly name: string;
  readonly body: string;
  readonly purpose: string;
}

export const PTAH_UI_CORPUS: readonly PtahUiCorpusCase[] = [
  {
    name: 'turn-summary-sources-crlf',
    body: 'title Release readiness\r\nstats\r\n  Files changed | $diff.files\r\n  Tests passed | $tests.passed\r\n  Prompt cost | $usage.cost\r\n  Quoted budget | \\$5\r\n',
    purpose: 'A compact turn summary with source scalars, CRLF line endings, and an escaped leading dollar.',
  },
  {
    name: 'literal-table-escapes-unicode',
    body: 'title Migration notes\ntable\n  Check | Detail | Owner\n  Schema \\| contract | \\\\ | Priya\n  Price | $5 today | équipe\n  Empty detail |  | 東京\n',
    purpose: 'A literal table covering escaped pipe and backslash, an empty cell, a literal mid-cell dollar, and Unicode.',
  },
  {
    name: 'changed-files-columns',
    body: 'title Files prepared for review\ntable $diff\n  cols path | additions | deletions\n',
    purpose: 'A source table with an explicit compact column selection.',
  },
  {
    name: 'test-run-list',
    body: 'title Verification runs\nlist $tests\n',
    purpose: 'A source-backed list of test commands and outcomes.',
  },
  {
    name: 'coverage-trend-chart',
    body: 'title Coverage trend\nchart line Coverage by run\n  Baseline | 72.4\n  Parser | 78.1\n  Pipeline | 84.6\n',
    purpose: 'A line chart with realistic numeric progress points.',
  },
  {
    name: 'release-checklist-mixed',
    body: 'title Release checklist\nstats\n  Reviewers | 2\n  Risk | low\ntable\n  Area | Status\n  Parser | ready\n  Renderer | queued\nlist\n  - Run the focused shared tests\n  - Attach the compactness report\nchart bar Completed checks\n  Draft | 1\n  Verified | 3\n',
    purpose: 'A mixed agent update using title, stats, literal table, literal list, and bar chart.',
  },
];
