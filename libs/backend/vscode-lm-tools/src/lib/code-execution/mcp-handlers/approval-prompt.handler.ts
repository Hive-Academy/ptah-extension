/**
 * Approval Prompt Handler
 *
 * Handles the approval_prompt MCP tool for requesting user permission
 * via the VS Code webview UI.
 */

import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, type PermissionResponse } from '@ptah-extension/shared';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type { MCPRequest, MCPResponse, ApprovalPromptParams } from '../types';

/**
 * Dependencies for approval prompt handling
 */
export interface ApprovalPromptDependencies {
  permissionPromptService: PermissionPromptService;
  webviewManager: WebviewManager;
  logger: Logger;
}

/**
 * Handle approval_prompt MCP tool call
 *
 * Flow:
 * 1. Create permission request
 * 2. Send to webview for user interaction
 * 3. Wait for response via Promise-based resolver
 * 4. Format MCP response per Claude CLI expectations
 */
export async function handleApprovalPrompt(
  request: MCPRequest,
  params: ApprovalPromptParams,
  deps: ApprovalPromptDependencies
): Promise<MCPResponse> {
  const { permissionPromptService, webviewManager, logger } = deps;

  logger.debug('Handling approval_prompt', { params });

  // 1. Create permission request
  const permissionRequest = permissionPromptService.createRequest(params);

  // 2. Create Promise that will be resolved when user responds
  const responsePromise = new Promise<PermissionResponse>((resolve) => {
    permissionPromptService.setPendingResolver(
      permissionRequest.id,
      resolve,
      permissionRequest
    );
  });

  // 3. Send MCP permission request to webview via WebviewManager
  // The webview is registered as 'ptah.main' in angular-webview.provider.ts
  // Uses shared PERMISSION_REQUEST type (same as SDK)
  await webviewManager.sendMessage(
    'ptah.main',
    MESSAGE_TYPES.PERMISSION_REQUEST,
    permissionRequest
  );

  // 4. Wait for user response (or timeout)
  const response = await responsePromise;

  // 5. Format MCP response based on user decision
  return formatApprovalResponse(request, params, response, logger);
}

/**
 * Format the MCP response based on user's permission decision
 */
function formatApprovalResponse(
  request: MCPRequest,
  params: ApprovalPromptParams,
  response: PermissionResponse,
  logger: Logger
): MCPResponse {
  if (response.decision === 'allow' || response.decision === 'always_allow') {
    logger.info('Permission granted', {
      id: response.id,
      decision: response.decision,
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              behavior: 'allow',
              updatedInput: params.input,
            }),
          },
        ],
      },
    };
  } else {
    logger.info('Permission denied', {
      id: response.id,
      reason: response.reason,
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              behavior: 'deny',
              message: response.reason || 'User denied permission',
            }),
          },
        ],
      },
    };
  }
}
