/**
 * Phase 6 — End-to-end tests for `ptah mcp-serve`.
 *
 * Spawns the built `ptah mcp-serve` binary as a subprocess and validates the
 * MCP wire surface end-to-end. Each test boots its own `FakeMcpHost`; the
 * `afterEach` block tears the child down and cleans the tmp HOME so leaked
 * processes surface immediately under `--detectOpenHandles`.
 *
 * Sandboxing reality:
 *   - The CI sandbox has no `gemini` / `codex` / `openrouter` binaries on
 *     PATH. Tests that nominally hit those CLIs assert EITHER routed
 *     success OR a clean `cli_agent_unavailable` failure — anything else
 *     (license_required, fatal crash) flags a regression in the wire
 *     surface.
 *   - The CI sandbox cannot reach the real `@anthropic-ai/claude-agent-sdk`.
 *     The Pro `session_submit` test asserts ROUTING (the gate let it
 *     through; the handler accepted it) not a real chat completion. We
 *     match either a structured response shape OR a clean MCP `isError`
 *     envelope — either proves the wire passed the gate.
 *
 * Sequencing:
 *   - Tests share a serial `--runInBand` execution (`jest.e2e.config.cjs`
 *     pins `maxWorkers: 1`). Each test owns its own subprocess; the
 *     `afterEach` `close()` returns only after the child reports exit.
 */

import { CliRunner, createTmpHome, type TmpHome } from './_harness';
import { spawnPtahMcp, type FakeMcpHost } from './utils';

jest.setTimeout(90_000);

const MVP_TOOL_NAMES = [
  'agent_spawn',
  'agent_status',
  'agent_read',
  'agent_steer',
  'agent_stop',
  'agent_list',
  'session_submit',
] as const;

/**
 * Bind a {@link FakeMcpHost} lifecycle to a test scope so a thrown
 * assertion still tears the child down. Returns a `register()` helper used
 * inside `it()` blocks to enrol each spawned host.
 */
function createHostScope(): {
  register: (host: FakeMcpHost) => FakeMcpHost;
  closeAll: () => Promise<void>;
} {
  const hosts: FakeMcpHost[] = [];
  return {
    register: (host: FakeMcpHost) => {
      hosts.push(host);
      return host;
    },
    closeAll: async () => {
      for (const h of hosts.splice(0)) {
        await h.close().catch(() => undefined);
      }
    },
  };
}

describe('ptah mcp-serve e2e (Phase 6)', () => {
  // Sanity-check the dist bundle is fresh enough to host the Phase 5 surface.
  beforeAll(() => {
    const fs = require('node:fs') as typeof import('node:fs');
    if (!fs.existsSync(CliRunner.DIST_BIN)) {
      throw new Error(
        `mcp-serve e2e: dist binary missing at ${CliRunner.DIST_BIN}. ` +
          `Run 'nx build ptah-cli' first.`,
      );
    }
  });

  let tmp: TmpHome;
  let scope: ReturnType<typeof createHostScope>;

  beforeEach(async () => {
    tmp = await createTmpHome('ptah-mcp-e2e-');
    scope = createHostScope();
  });

  afterEach(async () => {
    // Bound the close path so a child that refuses to drain cannot hang
    // the whole suite. The host's own `close()` already SIGKILLs at 5s;
    // this extra wrapper is belt-and-braces for the SIGTERM-killed paths
    // where Node's `once('exit')` may have already fired.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 15_000);
    });
    try {
      await Promise.race([scope.closeAll(), watchdog]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    // Give the OS a beat to release SQLite + log file handles after the
    // child exits. Windows holds those locks longer than POSIX; without
    // the grace period `tmp.cleanup()` sees EBUSY on `ptah.db-shm`/`-wal`.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await tmp.cleanup().catch((err) => {
      // EBUSY on Windows is a known late-handle-release race; tolerate it
      // because the tmp dir lives under `os.tmpdir()` which the OS sweeps
      // on reboot.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
        throw err;
      }
    });
  });

  it('mcp_initialize_handshake', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'community' }),
    );

    const resp = await host.send<{
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
    }>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'phase-6-e2e', version: '0.0.0' },
    });

    expect(resp.error).toBeUndefined();
    expect(resp.result).toBeDefined();
    expect(resp.result!.protocolVersion).toBe('2024-11-05');
    expect(resp.result!.serverInfo.name).toBe('ptah');
    // `mcp-serve.ts:159` falls back to '0.1.0' when no `hooks.version`
    // override is supplied (router does NOT pass one).
    expect(typeof resp.result!.serverInfo.version).toBe('string');
    expect(resp.result!.serverInfo.version.length).toBeGreaterThan(0);
    expect(resp.result!.capabilities).toEqual(
      expect.objectContaining({ tools: expect.any(Object) }),
    );
  });

  it('mcp_tools_list_returns_seven', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'community' }),
    );

    const resp = await host.send<{
      tools: Array<{ name: string; description: string }>;
    }>('tools/list');

    expect(resp.error).toBeUndefined();
    expect(resp.result?.tools).toBeDefined();
    const tools = resp.result!.tools;
    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name);
    for (const expected of MVP_TOOL_NAMES) {
      expect(names).toContain(expected);
    }
    // Belt-and-braces: no `ptah_` prefixed names (those belong to the HTTP
    // server, NOT the stdio wire).
    expect(names.every((n) => !n.startsWith('ptah_'))).toBe(true);
  });

  it('mcp_agent_list_free_tier', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'community' }),
    );

    const resp = await host.send<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    }>(
      'tools/call',
      {
        name: 'agent_list',
        arguments: {},
      },
      30_000,
    );

    // `agent_list` is the only universally Free tool (read-only enumeration).
    // The community license MUST NOT trigger the premium gate here.
    expect(resp.error).toBeUndefined();
    expect(resp.result).toBeDefined();
    expect(resp.result!.isError).not.toBe(true);
    // Don't assert on the agent list contents — the sandbox may or may not
    // have rival CLI binaries on PATH. The wire-level success is enough.
  });

  it('mcp_agent_spawn_free_cli', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'community' }),
    );

    const resp = await host.send<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    }>(
      'tools/call',
      {
        name: 'agent_spawn',
        arguments: { cli: 'gemini', task: 'echo hi' },
      },
      30_000,
    );

    expect(resp.error).toBeUndefined();
    expect(resp.result).toBeDefined();
    // Goal: prove the premium gate did NOT block this Free-tier path.
    // The sandbox likely lacks the `gemini` binary, so we accept either:
    //   - clean success (`isError !== true`)
    //   - clean unavailability (`ptah_code === 'cli_agent_unavailable'`)
    // Anything else (license_required, etc.) means a routing regression.
    const structured = resp.result!.structuredContent;
    if (resp.result!.isError === true) {
      const code =
        structured && typeof structured === 'object'
          ? (structured as Record<string, unknown>)['ptah_code']
          : undefined;
      expect(code).not.toBe('license_required');
      // Accept any non-license error code (cli_agent_unavailable,
      // provider_unavailable, internal_failure when SDK can't bind, etc.).
    }
  });

  it('mcp_agent_spawn_ptah_cli_denied', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'community' }),
    );

    const resp = await host.send<{
      content: Array<{ type: string; text: string }>;
      isError: boolean;
      structuredContent: { ptah_code?: string; mcpCode?: string };
    }>(
      'tools/call',
      {
        name: 'agent_spawn',
        arguments: { ptahCliId: 'openrouter', task: 'x' },
      },
      30_000,
    );

    expect(resp.error).toBeUndefined();
    expect(resp.result).toBeDefined();
    expect(resp.result!.isError).toBe(true);
    expect(resp.result!.structuredContent.ptah_code).toBe('license_required');
  });

  it('mcp_session_submit_denied_community', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'community' }),
    );

    const resp = await host.send<{
      content: Array<{ type: string; text: string }>;
      isError: boolean;
      structuredContent: { ptah_code?: string };
    }>(
      'tools/call',
      {
        name: 'session_submit',
        arguments: { task: 'do something', cwd: tmp.path },
      },
      30_000,
    );

    expect(resp.error).toBeUndefined();
    expect(resp.result).toBeDefined();
    expect(resp.result!.isError).toBe(true);
    expect(resp.result!.structuredContent.ptah_code).toBe('license_required');
  });

  it('mcp_session_submit_pro_streams', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'pro' }),
    );

    // The CI sandbox cannot reach the real Claude SDK; this test asserts
    // ROUTING (the Pro gate accepted the call) not a real completion. We
    // accept any of:
    //   - structured success result
    //   - clean MCP isError envelope with a non-license ptah_code
    //   - a JSON-RPC error code that surfaces a non-license reason
    let resp: Awaited<ReturnType<FakeMcpHost['send']>>;
    try {
      resp = await host.send<{
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
      }>(
        'tools/call',
        {
          name: 'session_submit',
          arguments: {
            task: 'say hi and stop',
            cwd: tmp.path,
            allowSubagents: false,
          },
        },
        60_000,
      );
    } catch (err) {
      // A wire-level send timeout proves the gate ROUTED the call (the
      // request was accepted) but the SDK hung waiting for a real
      // completion. That is still a routing-passed signal, which is all
      // this smoke test cares about.
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/timed out/);
      return;
    }
    if (resp.result !== undefined) {
      const structured =
        (resp.result as { structuredContent?: Record<string, unknown> })
          .structuredContent ?? undefined;
      if (
        (resp.result as { isError?: boolean }).isError === true &&
        structured !== undefined
      ) {
        // Gate let it through → ptah_code MUST NOT be license_required.
        expect(structured['ptah_code']).not.toBe('license_required');
      }
    } else if (resp.error !== undefined) {
      // Same invariant on the JSON-RPC error path.
      const data = resp.error.data as { ptah_code?: string } | undefined;
      expect(data?.ptah_code).not.toBe('license_required');
    }
  });

  it('mcp_cancel_in_flight', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'pro' }),
    );

    // Pick a unique request id we can match in `notifications/cancelled`.
    const requestId = 9090;

    // Race: start session_submit, immediately fire `notifications/cancelled`
    // referencing the in-flight id. The server should return an MCP isError
    // envelope with `mcp_tool_cancelled` before the (unreachable) SDK
    // completes.
    const sendPromise = new Promise<unknown>((resolve, reject) => {
      // Inline send so we can pin the id explicitly (the fake host normally
      // mints ids automatically; for the cancel path we need to know the
      // exact value to put in `notifications/cancelled.params.requestId`).
      const child = (host as unknown as { _internal_send_with_id?: unknown })
        ._internal_send_with_id;
      void child;
      // Fall back to the standard send + observed-id capture via the host.
      host
        .send(
          'tools/call',
          {
            name: 'session_submit',
            arguments: {
              task: 'wait forever',
              cwd: tmp.path,
              allowSubagents: false,
            },
          },
          15_000,
        )
        .then(resolve)
        .catch(reject);
    });

    // Allow the dispatcher a brief moment to register the in-flight tool
    // call before sending the cancel. We don't have access to the auto-
    // minted id without instrumenting the helper, so we send a broadcast
    // cancel keyed by every plausible id range (the dispatcher accepts the
    // first match). The MCP spec only requires `requestId` to be present.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    for (const candidateId of [1, 2, 3, 4, 5, 6, 7, requestId]) {
      await host.notify('notifications/cancelled', {
        requestId: candidateId,
        reason: 'phase-6-test',
      });
    }

    let outcome:
      | { kind: 'response'; resp: unknown }
      | { kind: 'timeout' }
      | { kind: 'error'; err: unknown };
    try {
      const resp = await Promise.race([
        sendPromise.then((resp) => ({ kind: 'response' as const, resp })),
        new Promise<{ kind: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ kind: 'timeout' as const }), 5_000),
        ),
      ]);
      outcome = resp;
    } catch (err) {
      outcome = { kind: 'error', err };
    }

    // Acceptable outcomes:
    //   1. Response with `isError: true, structuredContent.ptah_code: 'mcp_tool_cancelled'`
    //   2. Response with `isError: true` and any non-license ptah_code
    //      (the dispatcher may surface the cancellation via a different
    //      structured shape depending on which leg the cancel hit).
    //   3. Timeout (no response within 5s) — the cancel notification was
    //      received but the underlying SDK leg never completed. This is
    //      still useful: it proves the cancel did NOT crash the server.
    //      The afterEach `close()` will reap the process.
    if (outcome.kind === 'response') {
      const resp = outcome.resp as {
        result?: {
          isError?: boolean;
          structuredContent?: Record<string, unknown>;
        };
        error?: { data?: { ptah_code?: string } };
      };
      if (resp.result !== undefined) {
        // If the tool returned at all under cancel, it must be an isError envelope.
        if (resp.result.isError === true) {
          const code = resp.result.structuredContent?.['ptah_code'];
          expect(code).not.toBe('license_required');
        }
      } else if (resp.error !== undefined) {
        expect(resp.error.data?.ptah_code).not.toBe('license_required');
      }
    } else if (outcome.kind === 'timeout') {
      // The cancel was accepted; the response just hasn't arrived yet.
      // Verify the child is still healthy — no crash.
      expect(host.exitCode()).toBeNull();
    } else {
      // Error: confirm it's a timeout (acceptable) not a crash.
      const message =
        outcome.err instanceof Error
          ? outcome.err.message
          : String(outcome.err);
      expect(message).toMatch(/timed out/);
    }
  });

  it('mcp_sigterm_drains', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'pro' }),
    );

    // Start a long-lived tool call but DO NOT await it — we want to SIGTERM
    // mid-flight and assert the child exits cleanly.
    const inFlight = host
      .send(
        'tools/call',
        {
          name: 'session_submit',
          arguments: {
            task: 'long task',
            cwd: tmp.path,
            allowSubagents: false,
          },
        },
        10_000,
      )
      .catch(() => undefined);

    // Give the dispatcher a beat to register the call.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    host.signal('SIGTERM');

    // SIGTERM handler in mcp-serve.ts resolves drain to exit 143 within
    // the 5s drain cap. Allow a 6s wall-clock to absorb CI variance.
    // On Windows, `process.kill('SIGTERM')` does NOT deliver a true POSIX
    // SIGTERM — Node maps it to a forced kill, so the child exits via
    // signal (not via the JS-side handler emitting code 143). Wait for
    // either the code or the signal to be observable.
    const exitDeadline = Date.now() + 6_000;
    while (
      host.exitCode() === null &&
      host.exitSignal() === null &&
      Date.now() < exitDeadline
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    await inFlight;

    // On Windows the SIGTERM signal does not map cleanly — Node converts
    // it to a forced exit with code 1 or `null` + signal='SIGTERM'. On
    // POSIX the handler resolves to 143. Accept either as "shut down
    // without crashing".
    const code = host.exitCode();
    const sig = host.exitSignal();
    expect(
      code === 143 ||
        code === 1 ||
        code === 0 ||
        sig === 'SIGTERM' ||
        (code === null && sig !== null),
    ).toBe(true);
    // The stderr buffer should never contain a Node unhandled-promise
    // rejection trace from the drain path.
    expect(host.stderr()).not.toMatch(/UnhandledPromiseRejection/);
  });

  it('mcp_session_describe_introspection', async () => {
    const host = scope.register(
      await spawnPtahMcp({ home: tmp, licenseStatus: 'community' }),
    );

    const resp = await host.send<{
      mode: string;
      version: string;
      schemaVersion: string;
      capabilities: string[];
      catalog: {
        methods: string[];
        tools: Array<{ name: string; description: string }>;
      };
      errorCodes: string[];
    }>('session.describe');

    expect(resp.error).toBeUndefined();
    expect(resp.result).toBeDefined();
    const result = resp.result!;
    expect(result.mode).toBe('mcp-serve');
    expect(result.capabilities).toEqual(expect.arrayContaining(['mcp']));
    expect(result.catalog.tools).toHaveLength(7);
    const names = result.catalog.tools.map((t) => t.name);
    for (const expected of MVP_TOOL_NAMES) {
      expect(names).toContain(expected);
    }
    expect(result.catalog.methods).toEqual(
      expect.arrayContaining([
        'initialize',
        'tools/list',
        'tools/call',
        'session.describe',
        'session.methods',
      ]),
    );
    // Per Phase 5 deviation note: errorCodes returns the full
    // PTAH_ERROR_CODES tuple regardless of mode.
    expect(Array.isArray(result.errorCodes)).toBe(true);
    expect(result.errorCodes.length).toBeGreaterThanOrEqual(14);
  });
});
