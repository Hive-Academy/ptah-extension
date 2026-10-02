import { GitOperationRegistry } from './git-operation.registry';

describe('GitOperationRegistry', () => {
  it('aborts a running operation on cancel and frees its id on settle', () => {
    const registry = new GitOperationRegistry();
    const handle = registry.start('op-1');
    if (!handle) throw new Error('expected a handle');

    expect(handle.signal?.aborted).toBe(false);
    expect(registry.cancel('op-1')).toBe(true);
    expect(handle.signal?.aborted).toBe(true);

    handle.settle();
    expect(registry.cancel('op-1')).toBe(false);
    expect(registry.start('op-1')).not.toBeNull();
  });

  it('refuses an id that is already running', () => {
    const registry = new GitOperationRegistry();
    expect(registry.start('op-1')).not.toBeNull();
    expect(registry.start('op-1')).toBeNull();
  });

  it('follows the caller signal, aborted before or after start', () => {
    const registry = new GitOperationRegistry();
    const early = new AbortController();
    early.abort();
    expect(registry.start('early', early.signal)?.signal?.aborted).toBe(true);

    const late = new AbortController();
    const handle = registry.start('late', late.signal);
    late.abort();
    expect(handle?.signal?.aborted).toBe(true);
  });

  it('stops listening to the caller signal once settled', () => {
    const registry = new GitOperationRegistry();
    const caller = new AbortController();
    const remove = jest.spyOn(caller.signal, 'removeEventListener');
    const handle = registry.start('op', caller.signal);

    handle?.settle();
    handle?.settle();

    expect(remove).toHaveBeenCalledTimes(1);
    caller.abort();
    expect(handle?.signal?.aborted).toBe(false);
  });

  it('registers nothing without an id and passes the caller signal through', () => {
    const registry = new GitOperationRegistry();
    const caller = new AbortController();
    const handle = registry.start(undefined, caller.signal);

    expect(handle?.signal).toBe(caller.signal);
    expect(registry.start(undefined)?.signal).toBeUndefined();
  });

  it('a settled handle never removes a newer registration of the same id', () => {
    const registry = new GitOperationRegistry();
    const first = registry.start('op');
    first?.settle();
    const second = registry.start('op');

    first?.settle();

    expect(registry.cancel('op')).toBe(true);
    expect(second?.signal?.aborted).toBe(true);
  });
});
