import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import type { MessageHandler } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { SetupGenerationOpenPayload } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class SetupGenerationOpenHandler implements MessageHandler {
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  readonly handledMessageTypes = [MESSAGE_TYPES.SETUP_GENERATION_OPEN] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (
      message.type !== MESSAGE_TYPES.SETUP_GENERATION_OPEN ||
      !this.isPayload(message.payload)
    )
      return;
    if (message.payload.workspacePath !== this.tabs.activeWorkspacePath) return;
    void this.launcher.open(message.payload).catch(() => undefined);
  }

  private isPayload(payload: unknown): payload is SetupGenerationOpenPayload {
    if (!payload || typeof payload !== 'object') return false;
    const value = payload as Record<string, unknown>;
    return (
      typeof value['workspacePath'] === 'string' &&
      value['workspacePath'].trim().length > 0 &&
      (value['workflow'] === 'setup-agent-generation' ||
        value['workflow'] === 'setup-project-prompt') &&
      (value['origin'] === 'analysis-result-continue' ||
        value['origin'] === 'independent-start')
    );
  }
}
