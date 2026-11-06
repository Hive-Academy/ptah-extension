import {
  DROPPED_TOKEN,
  HANG_BREADCRUMB_KEYS,
  HangBreadcrumbs,
  MAX_IN_FLIGHT_OPS,
  MAX_OPS_PER_BREADCRUMB,
  MAX_OP_NAME_LENGTH,
} from './hang-breadcrumbs';

const T0 = Date.parse('2026-11-06T04:16:51.995Z');

function create(): { crumbs: HangBreadcrumbs; advance: (ms: number) => void } {
  let now = T0;
  return {
    crumbs: new HangBreadcrumbs(() => now),
    advance: (ms) => {
      now += ms;
    },
  };
}

describe('HangBreadcrumbs', () => {
  it('names in-flight RPC and MCP operations with their start time, oldest first', () => {
    const { crumbs, advance } = create();
    crumbs.begin('rpc', 'chat:continue');
    advance(400);
    crumbs.begin('rpc', 'provider:getPlanLimits');
    crumbs.begin('mcp', 'ptah_memory_search');

    expect(crumbs.snapshot()).toEqual({
      [HANG_BREADCRUMB_KEYS.rpc]:
        'chat:continue@04:16:51.995, provider:getPlanLimits@04:16:52.395',
      [HANG_BREADCRUMB_KEYS.mcp]: 'ptah_memory_search@04:16:52.395',
      [HANG_BREADCRUMB_KEYS.slowSql]: '',
    });
  });

  it('clears an operation on end and ignores unknown or repeated tokens', () => {
    const { crumbs } = create();
    const token = crumbs.begin('rpc', 'session:list');
    crumbs.end(token);
    crumbs.end(token);
    crumbs.end(9_999);

    expect(crumbs.size).toBe(0);
    expect(crumbs.snapshot()[HANG_BREADCRUMB_KEYS.rpc]).toBe('');
  });

  it('bounds the in-flight set and counts what it dropped', () => {
    const { crumbs } = create();
    for (let i = 0; i < MAX_IN_FLIGHT_OPS; i++) crumbs.begin('rpc', `m${i}`);
    const overflow = crumbs.begin('rpc', 'one-too-many');
    crumbs.end(overflow);

    expect(overflow).toBe(DROPPED_TOKEN);
    expect(crumbs.size).toBe(MAX_IN_FLIGHT_OPS);
    const rpc = crumbs.snapshot()[HANG_BREADCRUMB_KEYS.rpc];
    expect(rpc.split(', ')).toHaveLength(MAX_OPS_PER_BREADCRUMB);
    expect(rpc).toContain(
      `(+${MAX_IN_FLIGHT_OPS - MAX_OPS_PER_BREADCRUMB} more)`,
    );
    expect(rpc).toContain('[dropped 1]');
  });

  it('clips long operation names', () => {
    const { crumbs } = create();
    crumbs.begin('mcp', 'x'.repeat(MAX_OP_NAME_LENGTH + 40));

    const [name] = crumbs.snapshot()[HANG_BREADCRUMB_KEYS.mcp].split('@');
    expect(name).toHaveLength(MAX_OP_NAME_LENGTH);
  });

  it('keeps the label of the last slow SQL statement', () => {
    const { crumbs } = create();
    crumbs.noteSlowSql('all SELECT * FROM memory_chunks WHERE id = ?', 8190.4);

    expect(crumbs.snapshot()[HANG_BREADCRUMB_KEYS.slowSql]).toBe(
      'all SELECT * FROM memory_chunks WHERE id = ? 8190ms at 04:16:51.995',
    );
  });

  it('pushes every change to the attached sink, starting with the current set', () => {
    const { crumbs } = create();
    const sink = jest.fn();
    crumbs.begin('rpc', 'before-attach');

    const detach = crumbs.attach(sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0][HANG_BREADCRUMB_KEYS.rpc]).toContain(
      'before-attach',
    );

    const token = crumbs.begin('mcp', 'tool');
    crumbs.end(token);
    crumbs.noteSlowSql('run INSERT', 60);
    expect(sink).toHaveBeenCalledTimes(4);

    detach();
    crumbs.begin('rpc', 'after-detach');
    expect(sink).toHaveBeenCalledTimes(4);
  });

  it('does not let a stale detach remove a newer sink', () => {
    const { crumbs } = create();
    const first = jest.fn();
    const second = jest.fn();
    const detachFirst = crumbs.attach(first);
    crumbs.attach(second);
    detachFirst();

    crumbs.begin('rpc', 'x');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('adds no keys on attach while nothing is recorded', () => {
    const { crumbs } = create();
    const sink = jest.fn();
    crumbs.attach(sink);

    expect(sink).not.toHaveBeenCalled();
  });
});
