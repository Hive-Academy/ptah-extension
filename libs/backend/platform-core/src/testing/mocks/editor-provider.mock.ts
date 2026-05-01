/**
 * `createMockEditorProvider` — `jest.Mocked<IEditorProvider>` with wired event
 * emitters so tests can assert subscribe/dispatch behaviour against the same
 * `IEvent<T>` contract the production impls use.
 */

import type { IEditorProvider } from '../../interfaces/editor-provider.interface';
import { createEvent } from '../../utils/event-emitter';

export interface MockEditorProviderState {
  setActiveEditor(filePath: string | undefined): void;
  openDocument(filePath: string): void;
}

export type MockEditorProvider = jest.Mocked<IEditorProvider> & {
  readonly __state: MockEditorProviderState;
};

export function createMockEditorProvider(
  overrides?: Partial<IEditorProvider>,
): MockEditorProvider {
  let activePath: string | undefined;
  const [onDidChangeActiveEditor, fireChangeEditor] = createEvent<{
    filePath: string | undefined;
  }>();
  const [onDidOpenDocument, fireOpenDocument] = createEvent<{
    filePath: string;
  }>();

  const mock = {
    onDidChangeActiveEditor,
    onDidOpenDocument,
    getActiveEditorPath: jest.fn((): string | undefined => activePath),
    __state: {
      setActiveEditor(filePath: string | undefined): void {
        activePath = filePath;
        fireChangeEditor({ filePath });
      },
      openDocument(filePath: string): void {
        fireOpenDocument({ filePath });
      },
    },
  } as unknown as MockEditorProvider;

  if (overrides && typeof overrides.getActiveEditorPath === 'function') {
    mock.getActiveEditorPath = jest.fn(overrides.getActiveEditorPath);
  }

  return mock;
}
