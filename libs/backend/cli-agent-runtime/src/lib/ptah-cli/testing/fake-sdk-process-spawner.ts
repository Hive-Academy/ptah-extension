import type { ISdkProcessSpawner } from '../../spawn/sdk-process-spawner.port';

type SpawnedProcess = ReturnType<ISdkProcessSpawner['spawn']>;
type SpawnOptions = Parameters<ISdkProcessSpawner['spawn']>[0];

type SpawnHooks = Parameters<ISdkProcessSpawner['spawn']>[1];

interface JestFnLike {
  (...args: unknown[]): unknown;
  mockReturnValue?(val: unknown): unknown;
}

function createJestMock<T extends (...args: never[]) => unknown>(impl?: T): T {
  const jestObj = (
    globalThis as unknown as { jest?: { fn: (fn?: unknown) => unknown } }
  ).jest;
  if (jestObj?.fn) {
    return jestObj.fn(impl) as unknown as T;
  }
  return impl ?? ((() => undefined) as unknown as T);
}

/**
 * Creates a minimal dummy SpawnedProcess conforming to the SDK contract.
 */
export function createDummySpawnedProcess(): SpawnedProcess {
  const killMock = createJestMock(() => true);
  if ((killMock as unknown as JestFnLike).mockReturnValue) {
    (killMock as unknown as JestFnLike).mockReturnValue!(true);
  }

  return {
    stdin: {} as never,
    stdout: {} as never,
    killed: false,
    exitCode: null,
    kill: killMock as unknown as SpawnedProcess['kill'],
    on: createJestMock() as unknown as SpawnedProcess['on'],
    once: createJestMock() as unknown as SpawnedProcess['once'],
    off: createJestMock() as unknown as SpawnedProcess['off'],
  };
}

/**
 * Typed fake implementing ISdkProcessSpawner for tests.
 * Signature drift against ISdkProcessSpawner will fail compilation.
 */
export class FakeSdkProcessSpawner implements ISdkProcessSpawner {
  public readonly spawn: ISdkProcessSpawner['spawn'] = createJestMock(
    (_options: SpawnOptions, _hooks?: SpawnHooks): SpawnedProcess =>
      createDummySpawnedProcess(),
  );
}

/**
 * Factory helper for FakeSdkProcessSpawner.
 */
export function createFakeSdkProcessSpawner(): FakeSdkProcessSpawner {
  return new FakeSdkProcessSpawner();
}
