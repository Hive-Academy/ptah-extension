/**
 * `createMockUserInteraction` — `jest.Mocked<IUserInteraction>` with sensible
 * no-op defaults (dismissed messages, undefined input, non-cancelling progress).
 */

import type { IUserInteraction } from '../../interfaces/user-interaction.interface';
import type {
  IProgress,
  QuickPickItem,
  QuickPickOptions,
  InputBoxOptions,
  ProgressOptions,
  ICancellationToken,
} from '../../types/platform.types';
import { createEvent } from '../../utils/event-emitter';

export type MockUserInteraction = jest.Mocked<IUserInteraction>;

function makeCancellationToken(): ICancellationToken {
  const [onCancellationRequested] = createEvent<void>();
  return {
    isCancellationRequested: false,
    onCancellationRequested,
  };
}

export function createMockUserInteraction(
  overrides?: Partial<IUserInteraction>,
): MockUserInteraction {
  const withProgress = async <T>(
    _options: ProgressOptions,
    task: (progress: IProgress, token: ICancellationToken) => Promise<T>,
  ): Promise<T> => {
    const progress: IProgress = { report: jest.fn() };
    return task(progress, makeCancellationToken());
  };

  const mock = {
    showErrorMessage: jest.fn(
      async (_message: string, ..._actions: string[]) => undefined,
    ),
    showWarningMessage: jest.fn(
      async (_message: string, ..._actions: string[]) => undefined,
    ),
    showInformationMessage: jest.fn(
      async (_message: string, ..._actions: string[]) => undefined,
    ),
    showQuickPick: jest.fn(
      async (
        _items: QuickPickItem[],
        _options?: QuickPickOptions,
      ): Promise<QuickPickItem | undefined> => undefined,
    ),
    showInputBox: jest.fn(
      async (_options?: InputBoxOptions): Promise<string | undefined> =>
        undefined,
    ),
    withProgress: jest.fn(withProgress),
    openExternal: jest.fn(async (_url: string): Promise<boolean> => true),
    writeToClipboard: jest.fn(async (_text: string): Promise<void> => {
      /* noop */
    }),
  } as unknown as MockUserInteraction;

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'function') {
        (mock as unknown as Record<string, unknown>)[key] = jest.fn(
          value as (...args: unknown[]) => unknown,
        );
      }
    }
  }

  return mock;
}
