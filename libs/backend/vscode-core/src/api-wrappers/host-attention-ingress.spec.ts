import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type * as vscode from 'vscode';
import type { Logger } from '../logging/logger';
import { WebviewManager } from './webview-manager';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

jest.mock('vscode', () => ({
  EventEmitter: jest.fn().mockImplementation(() => ({
    event: jest.fn(), fire: jest.fn(), dispose: jest.fn(),
  })),
  Disposable: jest.fn().mockImplementation((dispose: () => void) => ({ dispose })),
}));

const backendRoot = resolve(__dirname, '../../..');
const requestType = /MESSAGE_TYPES\.(PERMISSION_REQUEST|AGENT_MONITOR_PERMISSION_REQUEST|ASK_USER_QUESTION_REQUEST)\b/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

describe('host attention ingress', () => {
  function createManager(): WebviewManager {
    const logger = Object.assign(Object.create(null) as Logger, {
      debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    });
    return new WebviewManager({} as vscode.ExtensionContext, logger);
  }

  it('routes every backend request emission through a manager without a BATCH wrapper', () => {
    const emissions: string[] = [];
    for (const file of sourceFiles(backendRoot)) {
      if (file.endsWith('host-attention-coordinator.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(requestType)) {
        const prefix = source.slice(Math.max(0, match.index - 220), match.index);
        // This is a diagnostic log field; the same request is emitted by sendPermissionRequest.
        if (/messageType:\s*$/.test(prefix)) continue;
        const call = /(?:\.|\b)(sendMessage|broadcastMessage)\s*\(/g;
        const calls = [...prefix.matchAll(call)];
        const lastCall = calls.at(-1);
        expect(lastCall).toBeDefined();
        expect(prefix.slice(lastCall?.index).includes('MESSAGE_TYPES.BATCH')).toBe(false);
        expect(prefix.slice(0, lastCall?.index).slice(-80)).toMatch(/webviewManager\s*\.?\s*$/i);
        const emissionPath = relative(backendRoot, file).replaceAll('\\', '/');
        // Each owned producer must release the same host notice after its response or cleanup.
        // MCP approvals carry no owner session, so they stay in-app and never claim a host notice.
        if (emissionPath !== 'vscode-lm-tools/src/lib/code-execution/mcp-core/approval-prompt.handler.ts') {
          expect(source).toMatch(/hostAttention\?\.resolve\s*\(\s*attentionRequestKey\s*\(/);
        }
        emissions.push(`${emissionPath}:${match[1]}`);
      }
    }
    expect(emissions.sort()).toEqual([
      'agent-sdk/src/lib/permission/ask-user-question.service.ts:ASK_USER_QUESTION_REQUEST',
      'agent-sdk/src/lib/sdk-permission-handler.ts:AGENT_MONITOR_PERMISSION_REQUEST',
      'agent-sdk/src/lib/sdk-permission-handler.ts:PERMISSION_REQUEST',
      'cli-agent-runtime/src/lib/wiring/agent-events.ts:AGENT_MONITOR_PERMISSION_REQUEST',
      'rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:PERMISSION_REQUEST',
      'vscode-lm-tools/src/lib/code-execution/mcp-core/approval-prompt.handler.ts:PERMISSION_REQUEST',
    ].sort());
  });

  it('observes a request even when no view exists', async () => {
    const manager = createManager();
    const observer = { observe: jest.fn() };
    manager.setAttentionObserver(observer);

    await expect(manager.sendMessage('ptah.main', MESSAGE_TYPES.PERMISSION_REQUEST, { id: 'one' })).resolves.toBe(false);
    expect(observer.observe).toHaveBeenCalledTimes(1);
    expect(observer.observe).toHaveBeenCalledWith(MESSAGE_TYPES.PERMISSION_REQUEST, { id: 'one' });
    manager.dispose();
  });

  it('observes once before a broadcast reaches multiple views', async () => {
    const manager = createManager();
    const observer = { observe: jest.fn() };
    manager.setAttentionObserver(observer);
    const posts = [jest.fn().mockResolvedValue(true), jest.fn().mockResolvedValue(true)];
    posts.forEach((post, index) => {
      const view = Object.assign(Object.create(null) as vscode.WebviewView, {
        visible: true,
        webview: { postMessage: post },
        onDidDispose: jest.fn(),
        onDidChangeVisibility: jest.fn(),
      });
      manager.registerWebviewView(`ptah.view.${index}`, view);
    });
    posts[0].mockImplementationOnce(() => {
      expect(observer.observe).toHaveBeenCalledTimes(1);
      return Promise.resolve(true);
    });

    await manager.broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST, { id: 'one' });

    expect(observer.observe).toHaveBeenCalledTimes(1);
    expect(posts[0]).toHaveBeenCalledTimes(1);
    expect(posts[1]).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
});
