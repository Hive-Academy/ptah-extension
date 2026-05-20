/**
 * Unit tests for `anthropic-tool-merger`.
 *
 * Covers:
 *   1. caller-only — no workspace tools → caller list returned unchanged.
 *   2. workspace-only — undefined caller → workspace tools returned.
 *   3. caller wins on collision — workspace tool with same name is dropped
 *      and reported in `collisions`.
 *   4. order — caller first, workspace appended.
 *   5. malformed entries — entries without a `name` are skipped.
 */

import {
  mergeAnthropicTools,
  type AnthropicToolDefinition,
} from './anthropic-tool-merger.js';

const tool = (
  name: string,
  extra: Partial<AnthropicToolDefinition> = {},
): AnthropicToolDefinition => ({ name, ...extra }) as AnthropicToolDefinition;

describe('mergeAnthropicTools', () => {
  it('returns caller list unchanged when workspace is empty', () => {
    const caller = [tool('A'), tool('B')];
    const result = mergeAnthropicTools(caller, []);
    expect(result.tools).toEqual(caller);
    expect(result.collisions).toEqual([]);
  });

  it('returns workspace tools when caller is undefined', () => {
    const workspace = [tool('W1'), tool('W2')];
    const result = mergeAnthropicTools(undefined, workspace);
    expect(result.tools).toEqual(workspace);
    expect(result.collisions).toEqual([]);
  });

  it('caller wins on name collision and reports the collision', () => {
    const caller = [tool('Read', { description: 'caller-read' })];
    const workspace = [
      tool('Read', { description: 'workspace-read' }),
      tool('Write', { description: 'workspace-write' }),
    ];
    const result = mergeAnthropicTools(caller, workspace);
    expect(result.tools).toEqual([
      tool('Read', { description: 'caller-read' }),
      tool('Write', { description: 'workspace-write' }),
    ]);
    expect(result.collisions).toEqual(['Read']);
  });

  it('preserves caller order then appends workspace tools', () => {
    const caller = [tool('A'), tool('B')];
    const workspace = [tool('C'), tool('D')];
    const result = mergeAnthropicTools(caller, workspace);
    expect(result.tools.map((t) => t.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('skips workspace entries with missing or empty name', () => {
    const workspace = [
      tool('valid'),
      { name: '' } as AnthropicToolDefinition,
      { description: 'no-name' } as AnthropicToolDefinition,
    ];
    const result = mergeAnthropicTools([], workspace);
    expect(result.tools).toEqual([tool('valid')]);
  });

  it('reports multiple collisions in workspace order', () => {
    const caller = [tool('A'), tool('B'), tool('C')];
    const workspace = [tool('B'), tool('A'), tool('D')];
    const result = mergeAnthropicTools(caller, workspace);
    expect(result.collisions).toEqual(['B', 'A']);
    expect(result.tools.map((t) => t.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('does not mutate input arrays', () => {
    const caller = [tool('A')];
    const workspace = [tool('B')];
    const callerCopy = [...caller];
    const workspaceCopy = [...workspace];
    mergeAnthropicTools(caller, workspace);
    expect(caller).toEqual(callerCopy);
    expect(workspace).toEqual(workspaceCopy);
  });
});
