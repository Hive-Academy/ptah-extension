import { Injectable, inject, signal } from '@angular/core';
import {
  TabManagerService,
  isActiveWorkspaceTabSet,
} from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { VSCodeService, type MessageHandler } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { SetupGenerationOpenPayload } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class SetupGenerationOpenHandler implements MessageHandler {
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  private readonly vscode = inject(VSCodeService);
  readonly launchNotice = signal<string | null>(null);
  readonly handledMessageTypes = [MESSAGE_TYPES.SETUP_GENERATION_OPEN] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (
      message.type !== MESSAGE_TYPES.SETUP_GENERATION_OPEN ||
      !this.isPayload(message.payload)
    )
      return;
    if (
      !isActiveWorkspaceTabSet(
        message.payload.workspacePath,
        this.tabs.activeWorkspacePath,
        this.vscode.config().workspaceRoot,
        this.vscode.config().isVSCode,
      )
    ) {
      console.debug(
        '[SetupGenerationOpenHandler] Ignored a generation open for another workspace',
      );
      return;
    }
    this.launchNotice.set(null);
    void this.launcher
      .open(message.payload)
      .then((result) => {
        if (result.outcome === 'failed')
          this.launchNotice.set(
            'The generation tab could not open. Try Continue again.',
          );
      })
      .catch(() =>
        this.launchNotice.set(
          'The generation tab could not open. Try Continue again.',
        ),
      );
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
