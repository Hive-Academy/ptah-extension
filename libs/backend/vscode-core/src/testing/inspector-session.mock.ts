/**
 * A fake `node:inspector` session for hang-profiler specs. It records the
 * protocol calls and answers `Profiler.stop` with a synthetic profile, so no
 * spec attaches a real debugger to the Jest worker.
 */
import type { InspectorSessionPort } from '../diagnostics/hang-profiler';
import type { CpuProfileData } from '../diagnostics/hang-profile-summary';

export interface FakeInspectorSession extends InspectorSessionPort {
  readonly calls: string[];
  disconnected: boolean;
  /** Next profile `Profiler.stop` returns. */
  nextProfile: CpuProfileData;
  /** Method that rejects, to drive failure paths. */
  failOn: string | undefined;
}

/**
 * Two frames: `hotLoop` sampled `hotSamples` times and `idleish` once, every
 * sample 10 ms apart, ending at `endTime` µs.
 */
export function syntheticProfile(
  hotSamples = 50,
  endTime = 10_000_000,
): CpuProfileData {
  const samples = [3, ...Array.from({ length: hotSamples }, () => 2)];
  const timeDeltas = samples.map(() => 10_000);
  const startTime = endTime - timeDeltas.length * 10_000;
  return {
    nodes: [
      {
        id: 1,
        callFrame: { functionName: '(root)', url: '', lineNumber: -1 },
      },
      {
        id: 2,
        callFrame: {
          functionName: 'hotLoop',
          url: 'file:///app/main.js',
          lineNumber: 41,
        },
      },
      {
        id: 3,
        callFrame: {
          functionName: 'idleish',
          url: 'file:///app/other.js',
          lineNumber: 9,
        },
      },
    ],
    startTime,
    endTime,
    samples,
    timeDeltas,
  };
}

export function createFakeInspectorSession(): FakeInspectorSession {
  const session: FakeInspectorSession = {
    calls: [],
    disconnected: false,
    nextProfile: syntheticProfile(),
    failOn: undefined,
    post: (method: string) => {
      session.calls.push(method);
      if (session.failOn === method) {
        return Promise.reject(new Error(`${method} failed`));
      }
      if (method === 'Profiler.stop') {
        return Promise.resolve({ profile: session.nextProfile });
      }
      return Promise.resolve({});
    },
    disconnect: () => {
      session.disconnected = true;
    },
  };
  return session;
}
