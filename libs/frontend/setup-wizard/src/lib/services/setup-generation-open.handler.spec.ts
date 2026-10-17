import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { SetupGenerationOpenHandler } from './setup-generation-open.handler';

describe('SetupGenerationOpenHandler', () => {
  it('opens only a typed push for the active workspace', () => {
    const open = jest.fn().mockResolvedValue({ outcome: 'landed', tabId: 't' });
    TestBed.configureTestingModule({
      providers: [
        SetupGenerationOpenHandler,
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/ws' },
        },
        { provide: GenerationWorkflowLauncherService, useValue: { open } },
      ],
    });
    const handler = TestBed.inject(SetupGenerationOpenHandler);
    const payload = {
      workspacePath: '/ws',
      workflow: 'setup-agent-generation',
      origin: 'independent-start',
    };
    handler.handleMessage({ type: 'other', payload });
    handler.handleMessage({
      type: MESSAGE_TYPES.SETUP_GENERATION_OPEN,
      payload: { ...payload, workspacePath: '/other' },
    });
    handler.handleMessage({
      type: MESSAGE_TYPES.SETUP_GENERATION_OPEN,
      payload: { ...payload, workflow: 'bogus' },
    });
    expect(open).not.toHaveBeenCalled();
    handler.handleMessage({
      type: MESSAGE_TYPES.SETUP_GENERATION_OPEN,
      payload,
    });
    expect(open).toHaveBeenCalledWith(payload);
  });

  it('exposes a retry notice when the launcher fails', async () => {
    const open = jest.fn().mockResolvedValue({ outcome: 'failed' });
    TestBed.configureTestingModule({
      providers: [
        SetupGenerationOpenHandler,
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/ws' },
        },
        { provide: GenerationWorkflowLauncherService, useValue: { open } },
      ],
    });
    const handler = TestBed.inject(SetupGenerationOpenHandler);
    handler.handleMessage({
      type: MESSAGE_TYPES.SETUP_GENERATION_OPEN,
      payload: {
        workspacePath: '/ws',
        workflow: 'setup-agent-generation',
        origin: 'independent-start',
      },
    });
    await Promise.resolve();
    expect(handler.launchNotice()).toContain('Try Continue again');
  });
});
