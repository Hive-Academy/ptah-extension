/**
 * `CodeExecutionMCP` × `harness-sync` — REAL lock, REAL filesystem.
 *
 * ## Why this file exists separately
 *
 * `http-mcp-server.service.spec.ts` mocks `fs` wholesale, so it has to stub
 * `withMcpConfigLock` into a straight-through pass (the lock needs a real
 * filesystem). That stub is fine for asserting the lock is TAKEN and that the
 * read and the write sit inside it — but it means no concurrency is exercised
 * at all: every mutation completes inside one microtask, so two writers can
 * never actually be in flight together and a missing lock would look identical
 * to a present one.
 *
 * TASK_2026_332 asks for the missing half: `.mcp.json` has TWO writers in
 * production — this service, and `harness-sync`'s `claude` MCP facet — and the
 * property worth pinning is that a simultaneous mutation from each preserves
 * BOTH writers' keys. So this spec keeps the real `fs`, the real
 * `withMcpConfigLock`, and a real temporary workspace on disk.
 *
 * ## Only the FIRST test proves anything about the lock — read this before
 * ## trusting the other two
 *
 * Both facets' critical sections are fully SYNCHRONOUS: they read, mutate and
 * write with no `await` in between. Two such tasks cannot interleave on one
 * event loop no matter how they are started, so `Promise.all` over them passes
 * with the lock removed. Tests 2 and 3 are therefore WIRING SMOKE TESTS — they
 * prove the service and the facet agree about the path, the schema and the key
 * partition, and they would keep passing if `withMcpConfigLock` were deleted.
 * Verified by deleting it: 2 and 3 still pass, 1 fails.
 *
 * Test 1 is the concurrency-safety test. It introduces a real yield between the
 * harness writer's READ and its WRITE, which is the actual shape of the lost
 * update, and it is the only one here that fails when the lock is removed.
 *
 * Everything mocked below is mocked for module-loading reasons only (the
 * `vscode` ambient module and the transitive SDK imports), never to weaken the
 * behaviour under test.
 */

import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    PTAH_API_BUILDER: Symbol.for('PtahAPIBuilder'),
    LOGGER: Symbol.for('Logger'),
    PERMISSION_PROMPT_SERVICE: Symbol.for('PermissionPromptService'),
    WEBVIEW_MANAGER: Symbol.for('WebviewManager'),
  },
  Logger: class {},
  WebviewManager: class {},
  FileSystemManager: class {},
}));

jest.mock('../ptah-api-builder.service', () => ({
  IDE_CAPABILITIES_TOKEN: Symbol.for('IDECapabilities'),
  PtahAPIBuilder: class PtahAPIBuilderStub {},
}));

jest.mock('../../permission/permission-prompt.service', () => ({
  PermissionPromptService: class PermissionPromptServiceStub {},
}));

jest.mock('../mcp-core', () => ({ handleMCPRequest: jest.fn() }));

jest.mock('./http-server.handler', () => ({
  startHttpServer: jest.fn(),
  stopHttpServer: jest.fn(),
  getConfiguredPort: jest.fn(),
}));

import type * as http from 'http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
// The REAL lock and the REAL facet — that is the entire point of this spec.
import {
  createMcpFacet,
  withMcpConfigLock,
} from '@ptah-extension/harness-sync';

import { CodeExecutionMCP } from './http-mcp-server.service';
import type { PtahAPIBuilder } from '../ptah-api-builder.service';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type { PtahAPI } from '../types';
import {
  startHttpServer as startHttpServerMock,
  stopHttpServer as stopHttpServerMock,
  getConfiguredPort as getConfiguredPortMock,
} from './http-server.handler';

const startHttpServer = startHttpServerMock as jest.MockedFunction<
  typeof startHttpServerMock
>;
const stopHttpServer = stopHttpServerMock as jest.MockedFunction<
  typeof stopHttpServerMock
>;
const getConfiguredPort = getConfiguredPortMock as jest.MockedFunction<
  typeof getConfiguredPortMock
>;

const PORT = 51820;

let workspaceRoot: string;
let configPath: string;
let service: CodeExecutionMCP;

function buildService(): CodeExecutionMCP {
  const apiBuilder = {
    build: jest.fn((): PtahAPI => ({}) as unknown as PtahAPI),
    hasSymbolAndMemoryLayer: jest.fn(() => false),
  } as unknown as PtahAPIBuilder;

  return new CodeExecutionMCP(
    apiBuilder,
    createMockLogger() as unknown as Logger,
    createMockStateStorage() as unknown as IStateStorage,
    createMockWorkspaceProvider({
      folders: [workspaceRoot],
    }) as unknown as IWorkspaceProvider,
    {} as unknown as PermissionPromptService,
    undefined,
    undefined,
    // No CLI detector: every target but `claude` is gated on one, so this
    // suite exercises the same single `.mcp.json` it was written against.
    undefined,
  );
}

/** The `mcpServers` map as it currently stands ON DISK. */
function serversOnDisk(): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    mcpServers?: Record<string, unknown>;
  };
  return parsed.mcpServers ?? {};
}

beforeEach(async () => {
  jest.clearAllMocks();
  workspaceRoot = mkdtempSync(join(tmpdir(), 'ptah-mcp-concurrency-'));
  configPath = join(workspaceRoot, '.mcp.json');

  getConfiguredPort.mockReturnValue(PORT);
  startHttpServer.mockResolvedValue({
    server: {} as unknown as http.Server,
    port: PORT,
  });
  stopHttpServer.mockResolvedValue(undefined);

  service = buildService();
  await service.start();
});

afterEach(async () => {
  await service.disposeAsync();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('CodeExecutionMCP × harness-sync — one .mcp.json, two writers', () => {
  // THE concurrency-safety test: the only one in this file that fails when the
  // lock is removed. See the file header.
  it("CONCURRENCY: preserves BOTH writers' keys when a harness mutation and a registration overlap", async () => {
    // A hand-authored server, so the file exists and has something to lose.
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema: 'https://example.invalid/mcp.schema.json',
          mcpServers: {
            'my-own-server': { command: 'node', args: ['x.js'] },
          },
        },
        null,
        2,
      ) + '\n',
    );

    // A harness-shaped mutation with a real yield between its READ and its
    // WRITE. That yield is the whole lost update: two writers that each read,
    // each edit their own key, and each write their own copy back — the second
    // write wins whole and the first key is gone, with no error and no torn
    // file. Both facets do exactly this, just without an await in the middle.
    let enterHarness!: () => void;
    const harnessEntered = new Promise<void>((resolve) => {
      enterHarness = resolve;
    });
    let releaseHarness!: () => void;
    const harnessGate = new Promise<void>((resolve) => {
      releaseHarness = resolve;
    });

    const harnessMutation = withMcpConfigLock(configPath, async () => {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        mcpServers: Record<string, unknown>;
      };
      enterHarness();
      await harnessGate;
      config.mcpServers['harness-server'] = { command: 'node', args: ['h.js'] };
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    });

    await harnessEntered;

    // The service now wants the same file while the harness holds it.
    const registration = service.ensureRegisteredForSubagents();

    // Give it every chance to jump the queue before the harness has written.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(serversOnDisk()).not.toHaveProperty('ptah');

    releaseHarness();
    await harnessMutation;
    await registration;

    const servers = serversOnDisk();
    expect(servers['harness-server']).toEqual({
      command: 'node',
      args: ['h.js'],
    });
    expect(servers['ptah']).toEqual({
      type: 'http',
      url: `http://localhost:${PORT}`,
    });
    // ...and the user's own server survived both of them.
    expect(servers['my-own-server']).toEqual({
      command: 'node',
      args: ['x.js'],
    });
  });

  // WIRING SMOKE TEST, not a concurrency test — both critical sections are
  // synchronous, so this passes with the lock removed. What it does prove is
  // that the service and the facet agree about the path, the root key and the
  // key partition, which is worth pinning on its own.
  it('WIRING: the REAL claude facet and the service address one file and different keys', async () => {
    const facet = createMcpFacet('claude');

    await Promise.all([
      facet.write(workspaceRoot, 'github', {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@foo/github-mcp'],
      }),
      service.ensureRegisteredForSubagents(),
    ]);

    const servers = serversOnDisk();
    expect(Object.keys(servers).sort()).toEqual(['github', 'ptah']);
    expect(servers['ptah']).toEqual({
      type: 'http',
      url: `http://localhost:${PORT}`,
    });
  });

  // WIRING SMOKE TEST, same caveat as above: the removal path's critical
  // section is synchronous too, so this also passes with the lock removed.
  it('WIRING: removing the ptah key leaves a facet write in place', async () => {
    const facet = createMcpFacet('claude');
    await service.ensureRegisteredForSubagents();

    await Promise.all([
      facet.write(workspaceRoot, 'github', {
        type: 'stdio',
        command: 'npx',
      }),
      service.stop(),
    ]);

    const servers = serversOnDisk();
    expect(servers['github']).toBeDefined();
    expect(servers).not.toHaveProperty('ptah');
  });
});
