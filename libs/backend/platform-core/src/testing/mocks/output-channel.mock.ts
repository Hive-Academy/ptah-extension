/**
 * `createMockOutputChannel` — `jest.Mocked<IOutputChannel>` that records
 * `append`/`appendLine` traffic into an in-memory `lines` buffer so tests can
 * assert on observed log output without stubbing out Jest spies.
 */

import type { IOutputChannel } from '../../interfaces/output-channel.interface';

export interface MockOutputChannelState {
  readonly lines: string[];
  clear(): void;
}

export type MockOutputChannel = jest.Mocked<IOutputChannel> & {
  readonly __state: MockOutputChannelState;
};

export interface MockOutputChannelOverrides extends Partial<IOutputChannel> {
  name?: string;
}

export function createMockOutputChannel(
  overrides?: MockOutputChannelOverrides,
): MockOutputChannel {
  const lines: string[] = [];
  const name = overrides?.name ?? 'mock-output-channel';

  const mock = {
    name,
    appendLine: jest.fn((message: string): void => {
      lines.push(message);
    }),
    append: jest.fn((message: string): void => {
      if (lines.length === 0) {
        lines.push(message);
      } else {
        lines[lines.length - 1] = `${lines[lines.length - 1]}${message}`;
      }
    }),
    clear: jest.fn((): void => {
      lines.splice(0, lines.length);
    }),
    show: jest.fn((): void => {
      /* noop */
    }),
    dispose: jest.fn((): void => {
      lines.splice(0, lines.length);
    }),
    __state: {
      lines,
      clear(): void {
        lines.splice(0, lines.length);
      },
    },
  } as unknown as MockOutputChannel;

  if (overrides) {
    for (const key of [
      'appendLine',
      'append',
      'clear',
      'show',
      'dispose',
    ] as const) {
      const value = overrides[key];
      if (typeof value === 'function') {
        (mock as unknown as Record<string, unknown>)[key] = jest.fn(
          value as (...args: unknown[]) => unknown,
        );
      }
    }
  }

  return mock;
}
