/**
 * Specs for the `ptah_dashboard_propose_spec` MCP tool — TASK_2026_493_9f58.
 *
 * Two things under test:
 *
 * 1. The input schema is GENERATED from zod, not hand-written. The assertion
 *    that proves it is an equality against `z.toJSONSchema` output — a
 *    hand-maintained copy would drift from it the first time a budget changed,
 *    which is the whole failure this deliverable exists to prevent
 *    (`critique-engineering.md` section 4).
 * 2. The dispatcher contract: the tool is listed on every host, a valid spec
 *    comes back as plain text with no `isError`, and a rejection comes back as
 *    `isError: true` carrying the reason.
 */

import 'reflect-metadata';

import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import { DashboardProposeSpecInputSchema } from '@ptah-extension/shared/mcp-apps-contracts';
import { makeDashboardSpec, makeStat } from '@ptah-extension/shared/testing';
import {
  DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
  buildDashboardProposeSpecTool,
} from './dashboard-propose-spec.tool';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';

function asLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function buildDeps(
  proposeSpec?: jest.Mock,
): ProtocolHandlerDependencies & { proposeSpec: jest.Mock } {
  const spy = proposeSpec ?? jest.fn();
  return {
    proposeSpec: spy,
    ptahAPI: { dashboard: { proposeSpec: spy } } as unknown as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: asLogger(),
  };
}

/** The plain-text dashboard the namespace renders, as the dispatcher sees it. */
const DASHBOARD_TEXT = ['Build health', '', 'Passing: 9'].join('\n');

/** The namespace's accepted outcome, as the dispatcher sees it. */
const ACCEPTED = {
  status: 'accepted' as const,
  specId: 'build-health',
  revision: 1,
  bytes: 120,
  text: DASHBOARD_TEXT,
  delivery: { status: 'delivered' as const, surfaces: 1 },
};

function request(overrides: Partial<MCPRequest>): MCPRequest {
  return { jsonrpc: '2.0', id: 1, method: 'tools/list', ...overrides };
}

function toolResult(res: MCPResponse): { isError?: boolean; text: string } {
  const result = res.result as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: result.isError, text: result.content[0].text };
}

describe('the tool definition', () => {
  it('is named after the harness precedent it follows', () => {
    expect(DASHBOARD_PROPOSE_SPEC_TOOL_NAME).toBe(
      'ptah_dashboard_propose_spec',
    );
    expect(buildDashboardProposeSpecTool().name).toBe(
      DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
    );
  });

  it('generates its input schema from the zod contract, byte for byte', () => {
    const generated = z.toJSONSchema(DashboardProposeSpecInputSchema, {
      io: 'input',
      target: 'draft-7',
    });
    const { $schema: _dropped, ...expected } = generated;

    expect(buildDashboardProposeSpecTool().inputSchema).toEqual(expected);
  });

  it('takes one argument — `spec` — so there is no way to send half a spec', () => {
    const { inputSchema } = buildDashboardProposeSpecTool();

    expect(Object.keys(inputSchema.properties)).toEqual(['spec']);
    expect(inputSchema.required).toEqual(['spec']);
    expect(inputSchema.type).toBe('object');
  });

  it('emits the recursive component tree as a NAMED definition plus a $ref', () => {
    const schema = buildDashboardProposeSpecTool().inputSchema as unknown as {
      definitions?: Record<string, { oneOf?: unknown[] }>;
    };

    expect(schema.definitions?.['DashboardComponent']).toBeDefined();
    expect(schema.definitions?.['DashboardComponent']?.oneOf).toHaveLength(5);
  });

  it('carries no $schema keyword — an MCP inputSchema is a fragment', () => {
    expect('$schema' in buildDashboardProposeSpecTool().inputSchema).toBe(
      false,
    );
  });

  it('closes every object, so an unknown key is described as invalid to the agent too', () => {
    const schema = buildDashboardProposeSpecTool()
      .inputSchema as unknown as Record<string, unknown>;

    expect(schema['additionalProperties']).toBe(false);
  });

  it('tells the agent that text is plain, with no markdown and no HTML', () => {
    // Revision 1, finding 1: `format: "markdown"` was a URL channel that
    // bypassed the scheme allowlist. The tool description advertised it, so it
    // must stop advertising it too — an agent that reads "markdown" here will
    // send markdown and get the whole spec rejected.
    const { description } = buildDashboardProposeSpecTool();

    // It must not OFFER markdown as a value. Saying the contract HAS none is
    // exactly the guidance an agent needs, so the bare word is allowed.
    expect(description).not.toContain('"plain" | "markdown"');
    expect(description).not.toMatch(/format\??\s*:/);
    expect(description).toContain('PLAIN TEXT');
    expect(description).toContain('no markdown and no HTML anywhere');
    expect(description).toContain('dashboard.open-url action instead');
  });

  it('teaches the limits and the allowlists from the contract, not from prose', () => {
    const { description } = buildDashboardProposeSpecTool();

    expect(description).toContain('dashboard-spec/1');
    expect(description).toContain('dashboard-catalog/1');
    expect(description).toContain('stat, line-chart, bar-chart, table, list');
    expect(description).toContain('dashboard.open-url');
    expect(description).toContain('262144 UTF-8 bytes');
    expect(description).toContain('javascript:, data:, file: and http: are');
  });
});

describe('tools/list', () => {
  it('lists the tool with no namespace toggle and no IDE capability', async () => {
    const res = await handleMCPRequest(
      request({ id: 'list', method: 'tools/list' }),
      buildDeps(),
    );
    const names = (
      res.result as { tools: Array<{ name: string }> }
    ).tools.map((tool) => tool.name);

    expect(names).toContain(DASHBOARD_PROPOSE_SPEC_TOOL_NAME);
  });

  it('stays listed even when every namespace toggle is off', async () => {
    const deps = buildDeps();
    const res = await handleMCPRequest(
      request({ id: 'list', method: 'tools/list' }),
      {
        ...deps,
        disabledMcpNamespaces: [
          'ide',
          'agent',
          'git',
          'json',
          'browser',
          'harness',
          'code',
          'dashboard',
        ],
      },
    );
    const names = (
      res.result as { tools: Array<{ name: string }> }
    ).tools.map((tool) => tool.name);

    expect(names).toContain(DASHBOARD_PROPOSE_SPEC_TOOL_NAME);
  });
});

describe('tools/call routing', () => {
  function call(args: Record<string, unknown>, deps: ProtocolHandlerDependencies) {
    return handleMCPRequest(
      request({
        id: 'call-99',
        method: 'tools/call',
        params: { name: DASHBOARD_PROPOSE_SPEC_TOOL_NAME, arguments: args },
      }),
      deps,
    );
  }

  it('forwards the spec untouched, with the request id as the tool call id', async () => {
    const proposeSpec = jest.fn(async () => ACCEPTED);
    const deps = buildDeps(proposeSpec);
    const spec = makeDashboardSpec({ components: [makeStat()] });

    await call({ spec }, deps);

    expect(proposeSpec).toHaveBeenCalledTimes(1);
    expect(proposeSpec).toHaveBeenCalledWith(spec, {
      sessionId: undefined,
      toolCallId: 'call-99',
    });
  });

  it('returns the plain-text dashboard as a success result', async () => {
    const deps = buildDeps(jest.fn(async () => ACCEPTED));

    const { isError, text } = toolResult(
      await call({ spec: makeDashboardSpec() }, deps),
    );

    expect(isError).toBeUndefined();
    expect(text).toBe(DASHBOARD_TEXT);
  });

  it('returns isError — not success — when delivery to the UI failed', async () => {
    // Revision 1, finding 2. Before the fix the namespace could not tell the
    // dispatcher that delivery had failed, so this case was reported as a
    // successful emission.
    const deps = buildDeps(
      jest.fn(async () => ({
        status: 'delivery-failed' as const,
        specId: 'build-health',
        revision: 1,
        bytes: 120,
        text: DASHBOARD_TEXT,
        reason:
          'Dashboard spec build-health revision 1 is valid but was NOT fully delivered to the UI.',
        delivery: {
          status: 'failed' as const,
          delivered: 0,
          surfaces: 1,
          reason: '1 of 1 attached surface(s) did not accept the spec',
        },
      })),
    );

    const { isError, text } = toolResult(
      await call({ spec: makeDashboardSpec() }, deps),
    );

    expect(isError).toBe(true);
    expect(text).toContain('NOT fully delivered');
    // Still carries the dashboard: a transport problem must not lose content.
    expect(text).toContain('Passing: 9');
  });

  it('keeps a host with NO surface a success, because that path is deliberate', async () => {
    const deps = buildDeps(
      jest.fn(async () => ({
        ...ACCEPTED,
        delivery: { status: 'no-surface' as const },
      })),
    );

    const { isError, text } = toolResult(
      await call({ spec: makeDashboardSpec() }, deps),
    );

    expect(isError).toBeUndefined();
    expect(text).toBe(DASHBOARD_TEXT);
  });

  it('returns isError with the reason when the namespace rejects', async () => {
    const deps = buildDeps(
      jest.fn(async () => ({
        status: 'rejected' as const,
        reason: 'Dashboard spec rejected: schemaVersion: bad. Nothing was sent to the UI.',
      })),
    );

    const { isError, text } = toolResult(await call({ spec: {} }, deps));

    expect(isError).toBe(true);
    expect(text).toContain('Nothing was sent to the UI.');
  });

  it('forwards a missing `spec` to the validator rather than pre-judging it', async () => {
    // The dispatcher must NOT grow its own shape check: a second, weaker copy
    // of the contract would report a worse reason than the validator's.
    const proposeSpec = jest.fn(async () => ({
      status: 'rejected' as const,
      reason: 'Dashboard spec rejected: invalid input.',
    }));
    const deps = buildDeps(proposeSpec);

    const { isError } = toolResult(await call({}, deps));

    expect(proposeSpec).toHaveBeenCalledWith(undefined, expect.any(Object));
    expect(isError).toBe(true);
  });
});
