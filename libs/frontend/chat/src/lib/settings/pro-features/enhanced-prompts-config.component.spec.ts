import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcSuccess } from '@ptah-extension/core/testing';
import { EnhancedPromptsConfigComponent } from './enhanced-prompts-config.component';

/**
 * Regression (Batch 41 rework): `enhancedPrompts:regenerate` reports a failed generation as
 * `{success:false, error}` inside a successful RPC; it must surface, not pass as done.
 * This component moves into the D-SP drawer in Batch 42, which carries this spec over.
 */
describe('EnhancedPromptsConfigComponent regenerate', () => {
  let call: jest.Mock;

  beforeEach(() => {
    call = jest.fn(async (method: string) => {
      if (method === 'enhancedPrompts:getStatus') return rpcSuccess({ enabled: true, hasGeneratedPrompt: true });
      return rpcSuccess({ success: false, error: 'Generation failed: no workspace.' });
    });
    TestBed.configureTestingModule({
      imports: [EnhancedPromptsConfigComponent],
      providers: [{ provide: ClaudeRpcService, useValue: { call } }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the host error for {success:false} and does not re-read the status', async () => {
    const component = TestBed.createComponent(EnhancedPromptsConfigComponent).componentInstance;
    call.mockClear();
    await component.regenerateEnhancedPrompt();
    expect(component.enhancedPromptsError()).toBe('Generation failed: no workspace.');
    expect(call).not.toHaveBeenCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });
    expect(component.isRegenerating()).toBe(false);
  });

  it('re-reads the status after a successful regeneration', async () => {
    call.mockImplementation(async () => rpcSuccess({ success: true, enabled: true, hasGeneratedPrompt: true }));
    const component = TestBed.createComponent(EnhancedPromptsConfigComponent).componentInstance;
    call.mockClear();
    await component.regenerateEnhancedPrompt();
    expect(component.enhancedPromptsError()).toBeNull();
    expect(call).toHaveBeenCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });
  });
});
