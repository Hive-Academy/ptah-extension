import 'reflect-metadata';
import { createMockEditorProvider } from '../mocks/editor-provider.mock';
import { runEditorProviderContract } from './run-editor-provider-contract';

runEditorProviderContract('createMockEditorProvider', () => {
  const provider = createMockEditorProvider();
  return {
    provider,
    trigger(action): void {
      if (action.kind === 'activate') {
        provider.__state.setActiveEditor(action.filePath);
      } else {
        provider.__state.openDocument(action.filePath);
      }
    },
  };
});
