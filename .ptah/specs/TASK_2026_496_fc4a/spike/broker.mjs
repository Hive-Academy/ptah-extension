// Single-owner MCP broker for TASK_2026_496_fc4a.
// Throwaway spike code. Not product code.
//
// Ptah owns the ONLY upstream connection (one Client, one StdioClientTransport).
// The same upstream server is handed to the vendor agent SDK again as an
// in-process SDK server built with createSdkMcpServer(). The SDK server's tool
// handlers forward to the one owned client, so there is never a second process.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// Minimal JSON Schema -> Zod raw shape. The spike fixture only uses flat
// string/number/boolean properties. A product broker needs a real converter.
function shapeFromJsonSchema(schema) {
  const shape = {};
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  for (const [key, prop] of Object.entries(props)) {
    let field;
    switch (prop.type) {
      case 'number':
      case 'integer':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      default:
        field = z.string();
    }
    if (prop.description) field = field.describe(prop.description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

export class SingleOwnerBroker {
  /**
   * @param {{ name: string, command: string, args: string[], env?: Record<string,string> }} spec
   */
  constructor(spec) {
    this.spec = spec;
    /** @type {Client | null} */
    this.client = null;
    /** @type {StdioClientTransport | null} */
    this.transport = null;
    this.tools = [];
    this.events = [];
  }

  #record(event, extra = {}) {
    this.events.push({ ts: Date.now(), event, ...extra });
  }

  async connect() {
    if (this.client) throw new Error('broker already connected: refusing a second upstream transport');
    const transport = new StdioClientTransport({
      command: this.spec.command,
      args: this.spec.args,
      env: { ...process.env, ...(this.spec.env ?? {}) },
      stderr: 'inherit',
    });
    const client = new Client({ name: 'ptah-broker', version: '0.0.0' }, { capabilities: {} });
    this.#record('broker.connect.start');
    await client.connect(transport);
    this.client = client;
    this.transport = transport;
    this.#record('broker.connect.done');
    await this.refreshTools();
  }

  async close() {
    if (!this.client) return;
    this.#record('broker.close.start');
    await this.client.close();
    this.client = null;
    this.transport = null;
    this.#record('broker.close.done');
  }

  /** Close-before-replace. The old transport is fully closed before a new one starts. */
  async reconnect() {
    await this.close();
    await this.connect();
  }

  /** Host path: the full tool list, with `_meta` kept. */
  async refreshTools() {
    const res = await this.client.request({ method: 'tools/list' }, z.any());
    this.tools = res.tools;
    return this.tools;
  }

  /** Host path: resources. The SDK gives the host no resource API at all. */
  async listResources() {
    return (await this.client.request({ method: 'resources/list' }, z.any())).resources;
  }

  async readResource(uri) {
    return await this.client.request({ method: 'resources/read', params: { uri } }, z.any());
  }

  async callTool(name, args) {
    return await this.client.request(
      { method: 'tools/call', params: { name, arguments: args ?? {} } },
      z.any()
    );
  }

  /**
   * Re-expose the SAME upstream server to the vendor SDK as an in-process SDK
   * server. The server name is the upstream name, so `mcp__<server>__<tool>`
   * identities and permission rules do not change.
   */
  createSdkServer() {
    if (!this.client) throw new Error('connect() first');
    const tools = this.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: shapeFromJsonSchema(t.inputSchema),
      annotations: t.annotations,
      _meta: t._meta,
      handler: async (args) => {
        this.#record('sdk.tool.forward', { tool: t.name });
        const result = await this.callTool(t.name, args);
        return { content: result.content ?? [], isError: result.isError ?? false };
      },
    }));
    return createSdkMcpServer({ name: this.spec.name, version: '0.0.0', tools });
  }
}

/**
 * FAIL CLOSED. A settings-file server that shares a name with a broker-owned
 * registration is a collision. Ptah cannot own that upstream connection, so the
 * broker refuses to start the session.
 * @param {string[]} brokerNames
 * @param {Record<string, unknown>} settingsServers servers found in settings files
 */
export function assertNoSettingsCollision(brokerNames, settingsServers) {
  const collisions = Object.keys(settingsServers ?? {}).filter((n) => brokerNames.includes(n));
  if (collisions.length > 0) {
    throw new Error(
      `MCP name collision, refusing to start: settings files declare ${collisions.join(', ')}, ` +
        `which the broker owns. Rename the settings entry or remove it.`
    );
  }
}
