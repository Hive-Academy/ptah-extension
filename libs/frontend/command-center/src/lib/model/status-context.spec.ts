import { buildStatusContext } from './status-context';
import type { CommandWorkNode } from './command-center.store';

describe('buildStatusContext', () => {
  it('uses only IDs, states and ages, excluding label and provider secrets', () => {
    const nodes: CommandWorkNode[] = [
      {
        id: 'cli:a',
        parentId: null,
        label: 'secret password',
        providerId: 'api-key',
        state: 'running',
      },
    ];
    const block = buildStatusContext(nodes, new Map([['cli:a', 3000]]));
    expect(block).toContain('cli:a | running | 3s');
    expect(block).not.toMatch(/secret|api-key/);
  });
  it('bounds the block and counts truncation', () => {
    const nodes: CommandWorkNode[] = Array.from(
      { length: 100 },
      (_, index) => ({
        id: `cli:${index}`,
        parentId: null,
        label: '',
        providerId: null,
        state: 'running',
      }),
    );
    const block = buildStatusContext(nodes);
    expect(block.length).toBeLessThanOrEqual(2048);
    expect(block).toMatch(/more nodes/);
  });
  it('handles an empty tree', () =>
    expect(buildStatusContext([])).toBe(
      '<COMMAND_CENTER_STATUS_CONTEXT>\n\n</COMMAND_CENTER_STATUS_CONTEXT>',
    ));
});
