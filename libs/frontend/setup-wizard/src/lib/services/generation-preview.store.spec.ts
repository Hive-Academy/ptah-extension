import { TestBed } from '@angular/core/testing';
import type { SetupGenerationTabBinding, WizardPreviewGenerationResponse } from '@ptah-extension/shared';
import { GenerationPreviewStore } from './generation-preview.store';
import { WizardRpcService } from './wizard-rpc.service';

const binding: SetupGenerationTabBinding = { tabId: 'agent-tab', workspacePath: '/workspace', workflow: 'setup-agent-generation' };
const preview = (token = 'token-1'): WizardPreviewGenerationResponse => ({
  previewToken: token, agents: [], rivalStatus: 'listed',
  target: { harnessRoot: '/workspace', openedFolder: '/workspace/app', chosen: 'harness-root', openedIsHarnessRoot: false },
});
const withFile = (revision = 'rev-1', relPath = '.claude/agents/a.md'): WizardPreviewGenerationResponse => ({
  ...preview(), agents: [{ agentId: 'a', files: [{ target: 'claude', certainty: 'definite', relPath,
    willOverwrite: true, localState: 'exists', revision }] }] as WizardPreviewGenerationResponse['agents'],
});

describe('GenerationPreviewStore', () => {
  let store: GenerationPreviewStore;
  let previewGeneration: jest.Mock;
  beforeEach(() => {
    previewGeneration = jest.fn().mockResolvedValue(preview());
    TestBed.configureTestingModule({ providers: [GenerationPreviewStore, { provide: WizardRpcService, useValue: { previewGeneration } }] });
    store = TestBed.inject(GenerationPreviewStore);
  });
  it('binds the open and confirm comparisons to the tab', async () => {
    await store.open(['a'], false, binding);
    expect(previewGeneration).toHaveBeenCalledWith(['a'], undefined, binding);
    await store.confirm(['a']);
    expect(previewGeneration).toHaveBeenCalledTimes(2);
    expect(previewGeneration).toHaveBeenLastCalledWith(['a'], undefined, binding);
  });
  it('retries a failed bound comparison before confirmation', async () => {
    previewGeneration.mockRejectedValueOnce(new Error('private token')).mockResolvedValue(preview());
    await store.open(['a'], false, binding);
    expect(store.error()).toBe('Preview unavailable');
    expect(await store.confirm(['a'])).toEqual({ submit: false });
    expect(store.isOpen()).toBe(true);
    expect(store.preview()).toEqual(preview());
  });
  it('keeps legacy unbound create-only behavior after a failure', async () => {
    previewGeneration.mockRejectedValueOnce(new Error('unavailable'));
    await store.open(['a'], false);
    expect(await store.confirm(['a'])).toEqual({ submit: true, decisions: undefined });
  });
  it('drops a reply after the preview is cancelled', async () => {
    let resolve!: (value: WizardPreviewGenerationResponse) => void;
    previewGeneration.mockImplementationOnce(() => new Promise<WizardPreviewGenerationResponse>((next) => { resolve = next; }));
    const pending = store.open(['a'], false, binding);
    store.cancel(); resolve(preview()); await pending;
    expect(store.preview()).toBeNull();
  });
  it('keeps the dialog open when definite targets change before confirmation', async () => {
    previewGeneration.mockResolvedValueOnce(withFile()).mockResolvedValueOnce(withFile('rev-1', '.claude/agents/renamed.md'));
    await store.open(['a'], false, binding);
    expect(await store.confirm(['a'])).toEqual({ submit: false });
    expect(store.changed()).toBe(true);
    expect(store.isOpen()).toBe(true);
  });
  it('resets Replace when the file revision changes before confirmation', async () => {
    previewGeneration.mockResolvedValueOnce(withFile()).mockResolvedValueOnce(withFile('rev-2'));
    await store.open(['a'], false, binding);
    store.setRowDecision({ id: 'a', decision: 'replace' });
    expect(await store.confirm(['a'])).toEqual({ submit: false });
    expect(store.decisions()?.rows[0].decision).toBe('keep');
    expect(store.changed()).toBe(true);
  });
  it('resets decisions to Keep after changing the target root', async () => {
    previewGeneration.mockResolvedValueOnce(withFile()).mockResolvedValueOnce({ ...withFile(), target: { ...preview().target!, chosen: 'opened-folder' } });
    await store.open(['a'], false, binding);
    store.setRowDecision({ id: 'a', decision: 'replace' });
    await store.changeTarget(['a'], 'opened-folder');
    expect(previewGeneration).toHaveBeenLastCalledWith(['a'], 'opened-folder', binding);
    expect(store.decisions()?.rows[0].decision).toBe('keep');
  });
  it('reopens after preview-required using the root already chosen', async () => {
    previewGeneration.mockResolvedValueOnce(withFile())
      .mockResolvedValueOnce({ ...withFile(), target: { ...preview().target!, chosen: 'opened-folder' } })
      .mockResolvedValueOnce({ ...withFile(), target: { ...preview().target!, chosen: 'opened-folder' } });
    await store.open(['a'], false, binding);
    await store.changeTarget(['a'], 'opened-folder');
    await store.open(['a'], true, binding);
    expect(previewGeneration).toHaveBeenLastCalledWith(['a'], 'opened-folder', binding);
    expect(store.changed()).toBe(true);
    expect(store.isOpen()).toBe(true);
  });
});
