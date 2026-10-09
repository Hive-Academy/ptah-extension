import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type {
  RequestPermissionRequest,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import {
  ACP_MAX_MESSAGE_BYTES,
  AcpUnavailableError,
  connectAcp,
  loadAcpSdk,
  type AcpClientHandlers,
} from './acp-sdk-loader';

const SDK_SPECIFIER = '@agentclientprotocol/sdk';

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

/**
 * A minimal raw JSON-RPC agent over in-memory streams. It answers the requests
 * a test registers and records every message the client sends.
 */
function createRawPeer() {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const writer = agentToClient.writable.getWriter();
  const encoder = new TextEncoder();
  const received: JsonRpcMessage[] = [];
  const waiters: Array<{
    match: (m: JsonRpcMessage) => boolean;
    resolve: (m: JsonRpcMessage) => void;
  }> = [];
  const replies = new Map<string, (params: unknown) => unknown>();

  const send = (message: object): Promise<void> =>
    writer.write(encoder.encode(JSON.stringify(message) + '\n'));

  const onMessage = (message: JsonRpcMessage): void => {
    received.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
    if (message.method && message.id !== undefined) {
      const reply = replies.get(message.method);
      if (reply) {
        void send({
          jsonrpc: '2.0',
          id: message.id,
          result: reply(message.params),
        });
      }
    }
  };

  void (async () => {
    const reader = clientToAgent.readable.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) onMessage(JSON.parse(line) as JsonRpcMessage);
        newline = buffered.indexOf('\n');
      }
    }
  })();

  return {
    stream: {
      readable: agentToClient.readable,
      writable: clientToAgent.writable,
    },
    received,
    send,
    writeRaw: (bytes: Uint8Array) => writer.write(bytes),
    close: () => writer.close(),
    reply: (method: string, handler: (params: unknown) => unknown) =>
      replies.set(method, handler),
    next: (match: (m: JsonRpcMessage) => boolean): Promise<JsonRpcMessage> =>
      new Promise((resolve) => {
        const hit = received.find(match);
        if (hit) resolve(hit);
        else waiters.push({ match, resolve });
      }),
  };
}

function createHandlers(): AcpClientHandlers & {
  sessionUpdate: jest.Mock;
  requestPermission: jest.Mock;
} {
  return {
    sessionUpdate: jest.fn(async (_params: SessionNotification) => undefined),
    requestPermission: jest.fn(async (_params: RequestPermissionRequest) => ({
      outcome: { outcome: 'selected' as const, optionId: 'allow-once' },
    })),
  };
}

describe('loadAcpSdk', () => {
  it('loads the real ESM SDK under Jest and caches the module', async () => {
    const sdk = await loadAcpSdk();

    expect(typeof sdk.ClientSideConnection).toBe('function');
    expect(typeof sdk.ndJsonStream).toBe('function');
    await expect(loadAcpSdk()).resolves.toBe(sdk);
  });

  it('maps an import failure to AcpUnavailableError and retries on the next call', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock(SDK_SPECIFIER, () => {
        throw new Error('Cannot find module');
      });
      const loader =
        jest.requireActual<typeof import('./acp-sdk-loader')>(
          './acp-sdk-loader',
        );

      const failure = await loader.loadAcpSdk().catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(loader.AcpUnavailableError);
      expect((failure as Error).message).toContain(
        'The ACP client library could not be loaded: Cannot find module',
      );
      expect((failure as Error).message).toContain('@agentclientprotocol/sdk');

      jest.dontMock(SDK_SPECIFIER);
      const sdk = await loader.loadAcpSdk();
      expect(typeof sdk.ClientSideConnection).toBe('function');
    });
  });

  it('keeps the cause and a stable name on AcpUnavailableError', () => {
    const cause = new Error('boom');
    const error = new AcpUnavailableError(cause);

    expect(error.name).toBe('AcpUnavailableError');
    expect(error.cause).toBe(cause);
    expect(new AcpUnavailableError('plain text').message).toContain(
      'could not be loaded: plain text',
    );
  });
});

describe('connectAcp', () => {
  it('runs requests, notifications and agent-initiated requests through the real SDK', async () => {
    const peer = createRawPeer();
    peer.reply('initialize', () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [],
    }));
    const handlers = createHandlers();

    const connection = await connectAcp(peer.stream, handlers);
    const init = await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    expect(init.protocolVersion).toBe(1);
    expect(init.agentCapabilities?.loadSession).toBe(true);

    await peer.send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        },
      },
    });
    await peer.send({
      jsonrpc: '2.0',
      id: 'perm-1',
      method: 'session/request_permission',
      params: {
        sessionId: 's-1',
        toolCall: { toolCallId: 't-1', title: 'run shell' },
        options: [
          { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
        ],
      },
    });

    const permissionReply = await peer.next((m) => m.id === 'perm-1');
    expect(permissionReply.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    expect(handlers.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's-1',
        update: expect.objectContaining({
          sessionUpdate: 'agent_message_chunk',
        }),
      }),
    );

    await connection.cancel({ sessionId: 's-1' });
    const cancel = await peer.next((m) => m.method === 'session/cancel');
    expect(cancel.id).toBeUndefined();

    expect(connection.signal.aborted).toBe(false);
    await peer.close();
    await connection.closed;
    expect(connection.signal.aborted).toBe(true);
  });

  it('rejects pending requests when the agent stream closes', async () => {
    const peer = createRawPeer();
    const connection = await connectAcp(peer.stream, createHandlers());

    const pending = connection.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });
    await peer.next((m) => m.method === 'session/new');
    await peer.close();

    await expect(pending).rejects.toBeDefined();
  });

  it('closes the connection on an inbound message over the 8 MiB cap', async () => {
    expect(ACP_MAX_MESSAGE_BYTES).toBe(8 * 1024 * 1024);
    const peer = createRawPeer();
    const connection = await connectAcp(peer.stream, createHandlers());

    void peer
      .writeRaw(new Uint8Array(ACP_MAX_MESSAGE_BYTES + 1).fill(0x61))
      .catch(() => undefined);
    await connection.closed;

    expect(connection.signal.aborted).toBe(true);
  });
});

/**
 * Returns a description of every reference to the SDK in `source` that is not
 * type-only: value imports, value re-exports, `import()` and `require()`.
 */
function findRuntimeSdkReferences(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const isSdk = (node: ts.Node | undefined): boolean =>
    !!node &&
    ts.isStringLiteralLike(node) &&
    (node.text === SDK_SPECIFIER || node.text.startsWith(`${SDK_SPECIFIER}/`));
  const hits: string[] = [];
  const record = (node: ts.Node): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    hits.push(`${fileName}:${line + 1}: ${node.getText().split('\n')[0]}`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isSdk(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) record(node);
    } else if (ts.isExportDeclaration(node) && isSdk(node.moduleSpecifier)) {
      if (!node.isTypeOnly) record(node);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isSdk(node.moduleReference.expression)
    ) {
      record(node);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      isSdk(node.arguments[0])
    ) {
      record(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

function listTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('SDK runtime import boundary', () => {
  const LOADER_FILES = new Set(['acp-sdk-loader.ts', 'acp-sdk-loader.spec.ts']);

  it('detects value imports and allows type-only ones (negative control)', () => {
    const source = [
      `import type { Client } from '${SDK_SPECIFIER}';`,
      `import type * as Sdk from '${SDK_SPECIFIER}';`,
      `export type { Agent } from '${SDK_SPECIFIER}';`,
      `type M = typeof import('${SDK_SPECIFIER}');`,
      `import { ndJsonStream } from '${SDK_SPECIFIER}';`,
      `import { type Stream } from '${SDK_SPECIFIER}';`,
      `export { RequestError } from '${SDK_SPECIFIER}';`,
      `const a = import('${SDK_SPECIFIER}');`,
      `const b = require('${SDK_SPECIFIER}/experimental/node');`,
    ].join('\n');

    const hits = findRuntimeSdkReferences('control.ts', source);

    expect(hits.map((h) => h.split(':')[1])).toEqual(['5', '6', '7', '8', '9']);
  });

  it('finds no runtime SDK reference in the ACP folder outside the loader', () => {
    const files = listTsFiles(__dirname).filter(
      (file) => !LOADER_FILES.has(path.basename(file)),
    );

    const hits = files.flatMap((file) =>
      findRuntimeSdkReferences(
        path.relative(__dirname, file),
        fs.readFileSync(file, 'utf8'),
      ),
    );

    expect(hits).toEqual([]);
  });

  it('finds the loader own dynamic import, so the walk would see a violation', () => {
    const loader = path.join(__dirname, 'acp-sdk-loader.ts');

    expect(
      findRuntimeSdkReferences(
        'acp-sdk-loader.ts',
        fs.readFileSync(loader, 'utf8'),
      ),
    ).toHaveLength(1);
  });
});
