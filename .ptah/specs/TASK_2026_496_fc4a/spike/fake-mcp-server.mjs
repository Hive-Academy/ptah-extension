// Fake stateful upstream MCP server for TASK_2026_496_fc4a.
// Throwaway spike code. Not product code.
//
// Every process instance is ONE upstream session. It appends a JSONL record to
// $SPIKE_LOG for `initialize` and for close, so the spike can count live
// transports and assert close-before-replace ordering.
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const LOG = process.env.SPIKE_LOG;
const ROLE = process.env.SPIKE_ROLE ?? 'broker-owned';
const SESSION = randomUUID();

function log(event, extra = {}) {
  if (!LOG) return;
  appendFileSync(
    LOG,
    JSON.stringify({ ts: Date.now(), event, session: SESSION, pid: process.pid, role: ROLE, ...extra }) + '\n'
  );
}

// The one piece of per-session state. Two upstream processes = two of these.
const state = { memory: 'EMPTY', callCount: 0 };

const TOOLS = [
  {
    name: 'spike_remember',
    description: 'Store a value in this session memory.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string', description: 'Value to store' } },
      required: ['value'],
    },
    _meta: {
      'openai/outputTemplate': 'ui://spike/card.html',
      'spike/uiResource': 'ui://spike/card.html',
      'spike/ownerSession': SESSION,
    },
  },
  {
    name: 'spike_recall',
    description: 'Return the value stored in this session memory.',
    inputSchema: { type: 'object', properties: {} },
    _meta: { 'spike/uiResource': 'ui://spike/card.html', 'spike/ownerSession': SESSION },
  },
];

const RESOURCES = [
  {
    uri: 'ui://spike/card.html',
    name: 'spike card',
    mimeType: 'text/html+skybridge',
    _meta: { 'spike/csp': "default-src 'none'" },
  },
  { uri: 'spike://memory', name: 'session memory', mimeType: 'application/json' },
];

const server = new Server(
  { name: 'fake-upstream', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true }, resources: { listChanged: true, subscribe: false } } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('tools/list');
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  state.callCount += 1;
  log('tools/call', { tool: req.params.name });
  if (req.params.name === 'spike_remember') {
    state.memory = String(req.params.arguments?.value ?? '');
    return {
      content: [{ type: 'text', text: `stored:${state.memory} session:${SESSION} calls:${state.callCount}` }],
      _meta: { 'spike/ownerSession': SESSION },
    };
  }
  if (req.params.name === 'spike_recall') {
    return {
      content: [{ type: 'text', text: `memory:${state.memory} session:${SESSION} calls:${state.callCount}` }],
      _meta: { 'spike/ownerSession': SESSION },
    };
  }
  return { isError: true, content: [{ type: 'text', text: `unknown tool ${req.params.name}` }] };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  log('resources/list');
  return { resources: RESOURCES };
});

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  log('resources/read', { uri: req.params.uri });
  if (req.params.uri === 'spike://memory') {
    return {
      contents: [
        {
          uri: 'spike://memory',
          mimeType: 'application/json',
          text: JSON.stringify({ memory: state.memory, session: SESSION, calls: state.callCount }),
        },
      ],
    };
  }
  if (req.params.uri === 'ui://spike/card.html') {
    return {
      contents: [
        {
          uri: 'ui://spike/card.html',
          mimeType: 'text/html+skybridge',
          text: `<!doctype html><p data-session="${SESSION}">spike card</p>`,
          _meta: { 'spike/csp': "default-src 'none'" },
        },
      ],
    };
  }
  throw new Error(`unknown resource ${req.params.uri}`);
});

server.oninitialized = () => log('initialize');

function close(reason) {
  log('close', { reason });
  process.exit(0);
}
process.stdin.on('end', () => close('stdin-end'));
process.stdin.on('close', () => close('stdin-close'));
process.on('SIGTERM', () => close('sigterm'));

await server.connect(new StdioServerTransport());
