/**
 * Specs for `ptah_surface_update` / `ptah_surface_get_state` (TASK_2026_538,
 * Task 13.2): generated schemas, contract-interpolated descriptions (Req
 * 8.6b) and the outcome-to-reply mapping the dispatcher delegates to.
 */

import 'reflect-metadata';

import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SurfaceEnvelope } from '@ptah-extension/shared';
import {
  SURFACE_ACTIONS,
  SURFACE_CATALOG_VERSION,
  SURFACE_COMPONENT_KINDS,
  SURFACE_LIMITS,
  SURFACE_SCHEMA_VERSION,
  SURFACE_STORE_LIMITS,
  SurfaceGetStateInputSchema,
  SurfaceUpdateInputSchema,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { SurfaceStateService } from '../../surface';
import { SURFACE_READER_MIN_STATE_READ_BYTES } from '../../surface/surface-state-reader';
import { buildSurfaceNamespace } from '../namespace-builders/surface-namespace.builder';
import {
  SURFACE_GET_STATE_TOOL_NAME,
  SURFACE_UPDATE_TOOL_NAME,
  buildSurfaceGetStateTool,
  buildSurfaceUpdateTool,
  formatKiB,
} from './surface-tools';
import {
  SURFACE_TOOL_UNEXPECTED_FAILURE,
  handleSurfaceToolCall,
  surfaceGetStateReply,
  surfaceUpdateReply,
} from './surface-tool-handlers';

type JsonObject = Record<string, unknown>;

function generated(schema: z.ZodType): JsonObject {
  const { $schema: _dropped, ...fragment } = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-7',
  }) as JsonObject;
  return fragment;
}

function withoutDescription(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return schema;
  const { description: _dropped, ...rest } = schema as JsonObject;
  return rest;
}

const DELIVERED = { status: 'delivered' as const, surfaces: 1 };
const QUIET_LOG = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

describe('ptah_surface_update definition', () => {
  const tool = buildSurfaceUpdateTool();
  const schema = tool.inputSchema as unknown as JsonObject;
  const properties = schema['properties'] as Record<string, JsonObject>;

  it('is named and non-destructive', () => {
    expect(tool.name).toBe(SURFACE_UPDATE_TOOL_NAME);
    expect(SURFACE_UPDATE_TOOL_NAME).toBe('ptah_surface_update');
    expect(tool.annotations?.destructiveHint).toBe(false);
  });

  it('is a closed top-level object with no $schema and no top-level oneOf', () => {
    expect('$schema' in schema).toBe(false);
    expect('oneOf' in schema).toBe(false);
    expect(schema['type']).toBe('object');
    expect(schema['required']).toEqual(['operation']);
    expect(schema['additionalProperties']).toBe(false);
    expect(properties['operation']).toEqual({
      type: 'string',
      enum: ['create', 'replace', 'patch', 'delete'],
    });
  });

  it('keeps every generated branch field and the recursive definitions verbatim', () => {
    const source = generated(SurfaceUpdateInputSchema);
    expect(schema['definitions']).toEqual(source['definitions']);
    expect(
      (schema['definitions'] as JsonObject)['SurfaceComponent'],
    ).toBeDefined();
    const branches = source['oneOf'] as JsonObject[];
    expect(branches).toHaveLength(4);
    for (const branch of branches) {
      for (const [key, value] of Object.entries(
        branch['properties'] as JsonObject,
      )) {
        if (key === 'operation') continue;
        expect(withoutDescription(properties[key])).toEqual(value);
      }
    }
    expect(Object.keys(properties).sort()).toEqual(
      ['baseRevision', 'operation', 'ops', 'surface', 'surfaceId'].sort(),
    );
  });

  it('names the operations that require each field', () => {
    expect(properties['surface']['description']).toContain(
      'Required for operation create, replace;',
    );
    expect(properties['baseRevision']['description']).toContain(
      'Required for operation replace, patch, delete;',
    );
    expect(properties['surfaceId']['description']).toContain(
      'Required for operation patch, delete;',
    );
    expect(properties['ops']['description']).toContain(
      'Required for operation patch;',
    );
  });

  it('interpolates every kind, action id and budget from the catalog (Req 8.6b)', () => {
    const { description } = tool;
    expect(description).toContain(SURFACE_SCHEMA_VERSION);
    expect(description).toContain(SURFACE_CATALOG_VERSION);
    for (const kind of SURFACE_COMPONENT_KINDS)
      expect(description).toContain(kind);
    for (const action of SURFACE_ACTIONS) expect(description).toContain(action);
    for (const [name, value] of Object.entries(SURFACE_LIMITS))
      expect(description).toContain(`${name} ${value}`);
    expect(description).toContain(
      `${SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId} surfaces per chat session`,
    );
    expect(description).toContain(
      `${SURFACE_STORE_LIMITS.maxRoutingIds} sessions per host`,
    );
    expect(description).toContain(
      `${SURFACE_STORE_LIMITS.maxStoreBytes} UTF-8 bytes`,
    );
  });

  it('states the staleness, anonymous and delivery-failure rules', () => {
    const { description } = tool;
    expect(description).toContain('baseRevision equal to the CURRENT revision');
    expect(description).toContain('rejected stale and nothing changes');
    expect(description).toContain('no interactive surface is attached');
    expect(description).toContain('surface state unavailable for this caller');
    expect(description).toContain('no surface state for this caller');
    expect(description).toContain(
      'states the committed revision: do not resend',
    );
  });

  it('states the Batch 4 semantic choices', () => {
    const { description } = tool;
    expect(description).toContain('set-title replaces the WHOLE header');
    expect(description).toContain(
      'index past the end of the target list is rejected',
    );
    expect(description).toContain(
      'Select and radio-group are empty only at null',
    );
    expect(description).toContain('required text is checked after trimming');
    expect(description).toContain(
      'cannot be selected by row, item or point index',
    );
  });
});

describe('ptah_surface_get_state definition', () => {
  const tool = buildSurfaceGetStateTool();

  it('is named, read-only and non-destructive', () => {
    expect(tool.name).toBe(SURFACE_GET_STATE_TOOL_NAME);
    expect(SURFACE_GET_STATE_TOOL_NAME).toBe('ptah_surface_get_state');
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it('generates its schema from zod, without $schema', () => {
    expect(tool.inputSchema).toEqual(generated(SurfaceGetStateInputSchema));
    expect('$schema' in tool.inputSchema).toBe(false);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual([
      'surfaceId',
      'view',
    ]);
  });

  it('quotes the read limit and the reader floor from their constants', () => {
    // The architect's "Batch 9 read-budget decision" and the reader's floor.
    expect(SURFACE_LIMITS.maxStateReadBytes).toBe(548 * 1024);
    expect(SURFACE_READER_MIN_STATE_READ_BYTES).toBe(40 * 1024);
    expect(formatKiB(SURFACE_LIMITS.maxStateReadBytes)).toBe('548 KiB');
    expect(formatKiB(SURFACE_READER_MIN_STATE_READ_BYTES)).toBe('40 KiB');

    const { description } = tool;
    expect(description).toContain(
      `maxStateReadBytes ${formatKiB(SURFACE_LIMITS.maxStateReadBytes)} (${SURFACE_LIMITS.maxStateReadBytes} UTF-8 bytes)`,
    );
    expect(description).toContain(
      `never below ${formatKiB(SURFACE_READER_MIN_STATE_READ_BYTES)} (${SURFACE_READER_MIN_STATE_READ_BYTES} UTF-8 bytes)`,
    );
    // Review F4: maxSurfaceBytes bounds the INPUT; the escaped structure
    // answer is bounded by maxStateReadBytes like every read.
    expect(description).toContain(
      `maxSurfaceBytes ${SURFACE_LIMITS.maxSurfaceBytes} UTF-8 bytes bounds the surface you SEND, not this answer`,
    );
    expect(description).not.toContain('within maxSurfaceBytes');
    expect(buildSurfaceUpdateTool().description).toContain(
      `${formatKiB(SURFACE_LIMITS.maxStateReadBytes)} (${SURFACE_LIMITS.maxStateReadBytes} UTF-8 bytes)`,
    );
  });

  it('states the anonymous rules and the v1 id form', () => {
    const { description } = tool;
    expect(description).toContain('no surface state for this caller');
    expect(description).toContain('"v1:<specId>"');
    expect(description).toContain('truncation marker');
  });
});

describe('surface outcome replies', () => {
  const committed = { surfaceId: 'profile', revision: 3, text: 'Profile' };

  it('maps accepted to success with the committed revision and delivery', () => {
    expect(
      surfaceUpdateReply({
        status: 'accepted',
        ...committed,
        delivery: DELIVERED,
      }),
    ).toEqual({
      isError: false,
      text: 'Surface profile committed at revision 3; delivery delivered to 1 attached surface(s).\n\nProfile',
    });
    expect(
      surfaceUpdateReply({
        status: 'accepted',
        ...committed,
        delivery: { status: 'no-surface' },
      }).text,
    ).toContain('no UI surface is attached');
  });

  it('maps delivery-failed, rejected and unavailable to errors', () => {
    expect(
      surfaceUpdateReply({
        status: 'delivery-failed',
        ...committed,
        reason: 'committed revision 3; do not resend',
        delivery: { status: 'failed', delivered: 0, surfaces: 1, reason: 'x' },
      }),
    ).toEqual({
      isError: true,
      text: 'committed revision 3; do not resend\n\nProfile',
    });
    expect(surfaceUpdateReply({ status: 'rejected', reason: 'bad' })).toEqual({
      isError: true,
      text: 'bad',
    });
    expect(
      surfaceUpdateReply({ status: 'unavailable', reason: 'gone' }),
    ).toEqual({ isError: true, text: 'gone' });
    expect(surfaceUpdateReply({ status: 'render-only', text: 'T' })).toEqual({
      isError: false,
      text: 'T',
    });
  });

  it('maps found and not-found reads to success, failures to errors', () => {
    expect(
      surfaceGetStateReply({
        status: 'found',
        text: 'S',
        truncated: false,
        omittedSurfaceIds: [],
      }),
    ).toEqual({ isError: false, text: 'S' });
    expect(surfaceGetStateReply({ status: 'not-found', text: 'N' })).toEqual({
      isError: false,
      text: 'N',
    });
    expect(surfaceGetStateReply({ status: 'rejected', reason: 'r' })).toEqual({
      isError: true,
      text: 'r',
    });
    expect(
      surfaceGetStateReply({ status: 'unavailable', reason: 'u' }),
    ).toEqual({ isError: true, text: 'u' });
  });
});

describe('handleSurfaceToolCall with the real namespace', () => {
  function snapshot(): SurfaceEnvelope {
    return {
      schemaVersion: SURFACE_SCHEMA_VERSION,
      catalogVersion: SURFACE_CATALOG_VERSION,
      surfaceId: 'profile',
      title: { text: 'Profile' },
      components: [{ kind: 'text', id: 'name', label: 'Name', path: 'name' }],
      dataModel: { name: 'Ada' },
    };
  }

  function setup(send: () => Promise<boolean>) {
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const sendMessage = jest.fn(send);
    const service = new SurfaceStateService(logger as unknown as Logger, {
      getHost: () => ({ getActiveWebviews: () => ['main'], sendMessage }),
    });
    return {
      surface: buildSurfaceNamespace({ service, logger }),
      sendMessage,
    };
  }

  it('reports a committed-but-undelivered patch as an error naming the revision', async () => {
    let deliver = true;
    const { surface, sendMessage } = setup(async () => deliver);
    const caller = { sessionId: 'tab-a', toolCallId: 'call-1' };
    await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: snapshot() },
      surface,
      caller,
      QUIET_LOG,
    );
    deliver = false;
    const patch = {
      operation: 'patch',
      surfaceId: 'profile',
      baseRevision: 1,
      ops: [{ op: 'set-data', path: 'name', value: 'Grace' }],
    };

    const failed = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      patch,
      surface,
      caller,
      QUIET_LOG,
    );
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('committed revision 2');
    expect(failed.text).toContain('do not resend');
    expect(failed.text).toContain('Grace');

    const retry = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      patch,
      surface,
      caller,
      QUIET_LOG,
    );
    expect(retry.isError).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns a complete structure read larger than maxSurfaceBytes but within maxStateReadBytes', async () => {
    // Review F4: 40 stats of 2,000 line separators each. Each separator is
    // 3 UTF-8 bytes in the input and 6 once escaped in the answer.
    const separators = String.fromCharCode(0x2028).repeat(2000);
    const { surface } = setup(async () => true);
    const caller = { sessionId: 'tab-a', toolCallId: 'call-1' };
    const created = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      {
        operation: 'create',
        surface: {
          ...snapshot(),
          components: Array.from({ length: 40 }, (_, index) => ({
            kind: 'stat',
            id: `stat-${index}`,
            value: separators,
          })),
          dataModel: {},
        },
      },
      surface,
      caller,
      QUIET_LOG,
    );
    expect(created.isError).toBe(false);

    const read = await handleSurfaceToolCall(
      SURFACE_GET_STATE_TOOL_NAME,
      { surfaceId: 'profile', view: 'structure' },
      surface,
      caller,
      QUIET_LOG,
    );
    const bytes = Buffer.byteLength(read.text, 'utf8');
    expect(read.isError).toBe(false);
    expect(bytes).toBeGreaterThan(SURFACE_LIMITS.maxSurfaceBytes);
    expect(bytes).toBeLessThanOrEqual(SURFACE_LIMITS.maxStateReadBytes);
    expect(read.text.includes(String.fromCharCode(0x2028))).toBe(false);
  });

  it('keeps host exception text out of a failed delivery (review F2)', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const service = new SurfaceStateService(logger as unknown as Logger, {
      getHost: () => {
        throw new Error('review-private-host-detail');
      },
    });
    const surface = buildSurfaceNamespace({ service, logger });

    const reply = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: snapshot() },
      surface,
      { sessionId: 'tab-a', toolCallId: 'call-1' },
      QUIET_LOG,
    );

    expect(reply.isError).toBe(true);
    expect(reply.text).not.toContain('review-private-host-detail');
    expect(reply.text).toContain('committed revision 1');
    expect(reply.text).toContain('do not resend');
    expect(reply.text).toContain('Name: Ada');
    // The raw detail is kept for the operator, in the guarded internal log.
    expect(JSON.stringify(logger.warn.mock.calls)).toContain(
      'review-private-host-detail',
    );
  });

  it('sanitizes an unexpected namespace exception', async () => {
    const warn = jest.fn(() => {
      throw new Error('log channel closed');
    });
    const throwing = {
      update: jest.fn(async () => {
        throw new Error('review-private-stack-detail');
      }),
      getState: jest.fn(),
    };

    const reply = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      {},
      throwing,
      { sessionId: 'tab-a', toolCallId: 'call-1' },
      { info: jest.fn(), warn, debug: jest.fn() },
    );

    expect(reply).toEqual({
      isError: true,
      text: SURFACE_TOOL_UNEXPECTED_FAILURE,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('matches the anonymous wording the description promises', async () => {
    const { surface } = setup(async () => true);
    const anonymous = { toolCallId: 'anon' };
    const rendered = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: snapshot() },
      surface,
      anonymous,
      QUIET_LOG,
    );
    const read = await handleSurfaceToolCall(
      SURFACE_GET_STATE_TOOL_NAME,
      {},
      surface,
      anonymous,
      QUIET_LOG,
    );
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain('no interactive surface is attached');
    expect(read).toEqual({
      isError: false,
      text: 'no surface state for this caller',
    });
    expect(buildSurfaceGetStateTool().description).toContain(read.text);
  });
});
