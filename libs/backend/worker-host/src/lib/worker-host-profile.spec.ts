describe('worker in-process RPC surface', () => {
  it('matches the CLI registered methods and documented host deltas', async () => {
    await import('@ptah-extension/platform-core');
    const { createCliRpcHostProfile } =
      await import('@ptah-extension/cli-engine');
    const { deriveRpcSurface } = await import('@ptah-extension/rpc-handlers');
    const { createWorkerRpcHostProfile } =
      await import('@ptah-extension/worker-runtime');
    const worker = createWorkerRpcHostProfile();
    const cli = createCliRpcHostProfile('cli');
    expect(deriveRpcSurface(worker).registered).toEqual(
      deriveRpcSurface(cli).registered,
    );
    expect(worker.host).toBe('worker');
    expect(cli.host).toBe('cli');
    expect(worker.capabilities).toEqual(cli.capabilities);
    expect(worker.wiring).toEqual(cli.wiring);
  });
});
