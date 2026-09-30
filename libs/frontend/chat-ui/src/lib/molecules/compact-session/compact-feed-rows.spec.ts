import { feedRow, wireBadgeClass } from './compact-feed-rows';
import type { CompactSemanticMark } from './compact-session-summary';

const mark = (
  overrides: Partial<CompactSemanticMark>,
): CompactSemanticMark => ({
  id: 'mark',
  kind: 'tool',
  tone: 'success',
  label: 'Read completed',
  timestamp: 1,
  ...overrides,
});

describe('compact-feed-rows', () => {
  it('builds a tool row from the target, with a status-coloured name badge', () => {
    const row = feedRow(
      mark({
        text: '.../app/main.ts',
        toolName: 'mcp__ptah__workspace_analyze',
      }),
    );

    expect(row.text).toBe('.../app/main.ts');
    expect(row.detail).toBeNull();
    expect(row.tool).toEqual({
      name: 'mcp__ptah__workspace_analyze',
      displayName: 'workspace analyze',
      badgeClass: expect.stringContaining('badge-success'),
    });
  });

  it('expands a failed tool row to its excerpt only', () => {
    const row = feedRow(
      mark({
        tone: 'error',
        label: 'Bash failed',
        text: 'Run tests',
        toolName: 'Bash',
        excerpt: 'Exit code 1',
      }),
    );

    expect(row.text).toBe('Run tests');
    expect(row.detail).toBe('Exit code 1');
    expect(row.tool?.badgeClass).toContain('badge-error');
  });

  it('builds a mark row from plain text, with no tool badge', () => {
    const row = feedRow(
      mark({
        kind: 'prose',
        label: 'Assistant response',
        text: '**Done** now',
      }),
    );

    expect(row.tool).toBeNull();
    expect(row.text).toBe('Done now');
    expect(row.title).toBe('Assistant response — Done now');
  });

  it('colours a wire badge by kind, and by error tone over kind', () => {
    expect(wireBadgeClass(mark({ kind: 'agent' }))).toContain('text-secondary');
    expect(wireBadgeClass(mark({ kind: 'agent', tone: 'error' }))).toContain(
      'text-error',
    );
  });
});
