/**
 * Unit tests for approval-prompt handler
 *
 * Covers:
 * - Pending → resolved flow (allow / deny / always_allow / deny_with_message)
 * - Auto-allow path when WebviewManager is absent (Electron)
 * - Webview message dispatch with PERMISSION_REQUEST type
 * - Resolver contract (Promise-based, resolved by caller)
 */

import 'reflect-metadata';

import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, type PermissionResponse } from '@ptah-extension/shared';
import {
  handleApprovalPrompt,
  type ApprovalPromptDependencies,
} from './approval-prompt.handler';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type {
  ApprovalPromptParams,
  MCPRequest,
} from '../types';

function createLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createWebviewManager(): jest.Mocked<WebviewManager> {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WebviewManager>;
}

interface FakePermissionService {
  createRequest: jest.Mock;
  setPendingResolver: jest.Mock;
  resolver?: (response: PermissionResponse) => void;
}

function createPermissionService(): FakePermissionService & PermissionPromptService {
  const svc: FakePermissionService = {
    createRequest: jest.fn((params: ApprovalPromptParams) => ({
      id: 'req-123',
      toolName: params.tool_name,
      toolInput: params.input,
      toolUseId: params.tool_use_id,
      timestamp: 1_700_000_000_000,
      description: `desc for ${params.tool_name}`,
      timeoutAt: 0,
    })),
    setPendingResolver: jest.fn(
      (_id: string, resolve: (r: PermissionResponse) => void) => {
        svc.resolver = resolve;
      },
    ),
  };
  return svc as unknown as FakePermissionService & PermissionPromptService;
}

function createRequest(id: string | number = 1): MCPRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
  };
}

function createParams(
  overrides: Partial<ApprovalPromptParams> = {},
): ApprovalPromptParams {
  return {
    tool_name: 'Bash',
    input: { command: 'ls -la' },
    tool_use_id: 'tool-use-abc',
    ...overrides,
  };
}

describe('handleApprovalPrompt', () => {
  let logger: jest.Mocked<Logger>;
  let webviewManager: jest.Mocked<WebviewManager>;
  let permissionPromptService: FakePermissionService & PermissionPromptService;
  let deps: ApprovalPromptDependencies;

  beforeEach(() => {
    logger = createLogger();
    webviewManager = createWebviewManager();
    permissionPromptService = createPermissionService();
    deps = { permissionPromptService, webviewManager, logger };
  });

  it('auto-allows when WebviewManager is absent (Electron branch)', async () => {
    const params = createParams();
    const response = await handleApprovalPrompt(createRequest(7), params, {
      permissionPromptService,
      logger,
    });

    expect(response.id).toBe(7);
    expect(response.jsonrpc).toBe('2.0');
    const content = (response.result as { content: Array<{ text: string }> })
      .content[0];
    const payload = JSON.parse(content.text) as {
      behavior: string;
      updatedInput: unknown;
    };
    expect(payload.behavior).toBe('allow');
    expect(payload.updatedInput).toEqual(params.input);
    // Must NOT have called webview/create request in auto-allow path
    expect(permissionPromptService.createRequest).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('auto-allowed'),
      expect.objectContaining({ tool: 'Bash' }),
    );
  });

  it('creates a permission request, registers resolver, and sends webview message', async () => {
    const pending = handleApprovalPrompt(
      createRequest(1),
      createParams(),
      deps,
    );

    // Allow microtasks to run so setPendingResolver & sendMessage are invoked.
    await Promise.resolve();
    await Promise.resolve();

    expect(permissionPromptService.createRequest).toHaveBeenCalledTimes(1);
    expect(permissionPromptService.setPendingResolver).toHaveBeenCalledWith(
      'req-123',
      expect.any(Function),
      expect.objectContaining({ id: 'req-123' }),
    );
    expect(webviewManager.sendMessage).toHaveBeenCalledWith(
      'ptah.main',
      MESSAGE_TYPES.PERMISSION_REQUEST,
      expect.objectContaining({ id: 'req-123' }),
    );

    // Resolve pending to avoid hanging the test.
    permissionPromptService.resolver?.({
      id: 'req-123',
      decision: 'allow',
    } as PermissionResponse);
    await pending;
  });

  it('formats MCP response as "allow" when user decision is allow', async () => {
    const params = createParams({ input: { file: '/a.ts' } });
    const pending = handleApprovalPrompt(createRequest(2), params, deps);
    await Promise.resolve();
    await Promise.resolve();

    permissionPromptService.resolver?.({
      id: 'req-123',
      decision: 'allow',
    } as PermissionResponse);

    const response = await pending;
    const payload = JSON.parse(
      (response.result as { content: Array<{ text: string }> }).content[0].text,
    );
    expect(payload).toEqual({
      behavior: 'allow',
      updatedInput: params.input,
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Permission granted',
      expect.objectContaining({ decision: 'allow' }),
    );
  });

  it('treats "always_allow" as allow in the MCP response', async () => {
    const pending = handleApprovalPrompt(
      createRequest(3),
      createParams(),
      deps,
    );
    await Promise.resolve();
    await Promise.resolve();

    permissionPromptService.resolver?.({
      id: 'req-123',
      decision: 'always_allow',
    } as PermissionResponse);

    const response = await pending;
    const payload = JSON.parse(
      (response.result as { content: Array<{ text: string }> }).content[0].text,
    );
    expect(payload.behavior).toBe('allow');
  });

  it('formats MCP response as "deny" with reason when user denies', async () => {
    const pending = handleApprovalPrompt(
      createRequest('req-str'),
      createParams(),
      deps,
    );
    await Promise.resolve();
    await Promise.resolve();

    permissionPromptService.resolver?.({
      id: 'req-123',
      decision: 'deny',
      reason: 'unsafe',
    } as PermissionResponse);

    const response = await pending;
    expect(response.id).toBe('req-str');
    const payload = JSON.parse(
      (response.result as { content: Array<{ text: string }> }).content[0].text,
    );
    expect(payload).toEqual({ behavior: 'deny', message: 'unsafe' });
    expect(logger.info).toHaveBeenCalledWith(
      'Permission denied',
      expect.objectContaining({ reason: 'unsafe' }),
    );
  });

  it('uses default deny message when reason is absent', async () => {
    const pending = handleApprovalPrompt(
      createRequest(4),
      createParams(),
      deps,
    );
    await Promise.resolve();
    await Promise.resolve();

    permissionPromptService.resolver?.({
      id: 'req-123',
      decision: 'deny',
    } as PermissionResponse);

    const response = await pending;
    const payload = JSON.parse(
      (response.result as { content: Array<{ text: string }> }).content[0].text,
    );
    expect(payload.behavior).toBe('deny');
    expect(payload.message).toBe('User denied permission');
  });

  it('propagates the same request id into the MCP response', async () => {
    const pending = handleApprovalPrompt(
      createRequest(999),
      createParams(),
      deps,
    );
    await Promise.resolve();
    await Promise.resolve();

    permissionPromptService.resolver?.({
      id: 'req-123',
      decision: 'allow',
    } as PermissionResponse);

    const response = await pending;
    expect(response.id).toBe(999);
  });

  it('does not send webview message if webviewManager is absent', async () => {
    await handleApprovalPrompt(createRequest(5), createParams(), {
      permissionPromptService,
      logger,
    });
    expect(webviewManager.sendMessage).not.toHaveBeenCalled();
  });
});
