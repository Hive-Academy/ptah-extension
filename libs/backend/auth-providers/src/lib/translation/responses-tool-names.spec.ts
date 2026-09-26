import { createHash } from 'node:crypto';
import {
  guardResponsesToolNames,
  ResponsesToolNameCollisionError,
} from './responses-tool-names';
import {
  translateAnthropicToResponses,
  type OpenAIResponsesRequest,
  type ResponsesFunctionCallItem,
  type ResponsesFunctionCallOutputItem,
  type ResponsesToolDefinition,
} from './responses-request-translator';
import type { AnthropicMessagesRequest } from './openai-translation.types';

jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, createHash: jest.fn(actual.createHash) };
});

const VALID = /^[a-zA-Z0-9_-]{1,64}$/;
// 70 characters, with dots that OpenAI rejects.
const LONG_MCP = 'mcp__server.with.dots__tool' + 'x'.repeat(43);
const hash10 = (name: string) =>
  jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 10);
const expectedAlias = (name: string) =>
  `${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 53)}_${hash10(name)}`;

const tool = (name: string): ResponsesToolDefinition =>
  ({ type: 'function', name, description: `desc ${name}`, parameters: { type: 'object' }, strict: false });
const call = (call_id: string, name: string): ResponsesFunctionCallItem =>
  ({ type: 'function_call', call_id, name, arguments: '{"q":"ok"}' });
const output = (call_id: string): ResponsesFunctionCallOutputItem =>
  ({ type: 'function_call_output', call_id, output: 'found' });
const request = (tools: string[], input: OpenAIResponsesRequest['input'] = []): OpenAIResponsesRequest =>
  ({ model: 'gpt-5.4', input, stream: true, store: false, tools: tools.map(tool) });

const toolName = (req: OpenAIResponsesRequest, index = 0): string => {
  const name = req.tools?.[index]?.name;
  if (name === undefined) throw new Error(`no tool at ${index}`);
  return name;
};

const deepFreeze =<T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

describe('guardResponsesToolNames', () => {
  beforeEach(() => jest.mocked(createHash).mockClear());

  it('aliases a 70-character MCP name to a compliant, deterministic name', () => {
    expect(LONG_MCP).toHaveLength(70);
    const first = toolName(guardResponsesToolNames(request([LONG_MCP])).request);
    const second = toolName(guardResponsesToolNames(request([LONG_MCP])).request);
    expect(first).toBe(expectedAlias(LONG_MCP));
    expect(first).toMatch(VALID);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first.startsWith('mcp__server_with_dots__tool')).toBe(true);
    expect(second).toBe(first);
  });

  it('keeps short invalid names readable under the 64-character limit', () => {
    const alias = guardResponsesToolNames(request(['a.b'])).request.tools?.[0]?.name;
    expect(alias).toBe(`a_b_${hash10('a.b')}`);
    expect(alias).toMatch(VALID);
  });

  it('gives an empty name a compliant alias', () => {
    const alias = guardResponsesToolNames(request([''])).request.tools?.[0]?.name;
    expect(alias).toBe(`_${hash10('')}`);
    expect(alias).toMatch(VALID);
  });

  it('gives a valid-character name over 64 characters a 64-character alias', () => {
    const name = 'a'.repeat(80);
    const alias = guardResponsesToolNames(request([name])).request.tools?.[0]?.name;
    expect(alias).toBe(`${'a'.repeat(53)}_${hash10(name)}`);
    expect(alias).toHaveLength(64);
  });

  it('returns a request deep-equal to the input when every name is valid, without hashing', () => {
    const input = deepFreeze(request(['Read', 'mcp__srv__tool', 'a'.repeat(64), 'x-y_z'],
      [{ role: 'user', content: 'hi' }, call('c1', 'Read'), output('c1')]));
    const snapshot = JSON.stringify(input);
    const guarded = guardResponsesToolNames(input);
    expect(guarded.request).toStrictEqual(input);
    expect(JSON.stringify(guarded.request)).toBe(snapshot);
    expect(createHash).not.toHaveBeenCalled();
  });

  it('keeps a request without tools free of a tools key', () => {
    const input: OpenAIResponsesRequest = { model: 'm', input: [call('c1', LONG_MCP)] };
    const guarded = guardResponsesToolNames(input);
    expect('tools' in guarded.request).toBe(false);
    expect((guarded.request.input[0] as ResponsesFunctionCallItem).name).toBe(expectedAlias(LONG_MCP));
  });

  it('never mutates its input and hashes each distinct invalid name once', () => {
    const input = deepFreeze(request([LONG_MCP, 'Read', 'b.c'],
      [call('c1', LONG_MCP), output('c1'), call('c2', LONG_MCP), call('c3', 'b.c')]));
    const snapshot = JSON.stringify(input);
    const guarded = guardResponsesToolNames(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(guarded.request).not.toBe(input);
    expect(createHash).toHaveBeenCalledTimes(2);
    // Unchanged entries are shared, rewritten ones are copies.
    expect(guarded.request.tools?.[1]).toBe(input.tools?.[1]);
    expect(guarded.request.tools?.[0]).not.toBe(input.tools?.[0]);
    expect(guarded.request.tools?.[0]).toEqual({ ...input.tools?.[0], name: expectedAlias(LONG_MCP) });
  });

  it('rewrites history function_call items identically to tools[]', () => {
    const guarded = guardResponsesToolNames(request([LONG_MCP],
      [{ role: 'user', content: 'go' }, call('c1', LONG_MCP), output('c1')]));
    const alias = guarded.request.tools?.[0]?.name;
    expect(guarded.request.input[1]).toEqual({ ...call('c1', LONG_MCP), name: alias });
    expect(guarded.request.input[0]).toEqual({ role: 'user', content: 'go' });
    expect(guarded.request.input[2]).toEqual(output('c1'));
  });

  it('aliases and reverses a history name whose tool was removed from tools[]', () => {
    const removed = 'mcp__gone.server__old_tool';
    const guarded = guardResponsesToolNames(request(['Read'], [call('c1', removed), output('c1')]));
    const alias = (guarded.request.input[0] as ResponsesFunctionCallItem).name;
    expect(alias).toBe(expectedAlias(removed));
    expect(alias).toMatch(VALID);
    expect(guarded.toOriginalName(alias)).toBe(removed);
    // Same alias the tools[] path would produce on a turn where the tool is present.
    expect(guardResponsesToolNames(request([removed])).request.tools?.[0]?.name).toBe(alias);
  });

  it('maps a known alias back to its original and passes unknown names through', () => {
    const { request: out, toOriginalName } = guardResponsesToolNames(request([LONG_MCP, 'Read']));
    expect(toOriginalName(toolName(out))).toBe(LONG_MCP);
    expect(toOriginalName('Read')).toBe('Read');
    expect(toOriginalName('not_a_tool')).toBe('not_a_tool');
    expect(toOriginalName(LONG_MCP)).toBe(LONG_MCP);
  });

  it('keeps reverse maps per request', () => {
    const a = guardResponsesToolNames(request(['a.b']));
    const b = guardResponsesToolNames(request(['c.d']));
    expect(b.toOriginalName(toolName(a.request))).toBe(toolName(a.request));
  });

  it('throws when two originals produce one alias', () => {
    const prefix = 'p'.repeat(53);
    // Force a hash-prefix collision: both names sanitize to the same 53 characters.
    const hashes = ['0123456789aaaa', '0123456789bbbb'];
    jest.mocked(createHash).mockImplementation(() => {
      const digest = hashes.shift() ?? '';
      return { update: () => ({ digest: () => digest }) } as unknown as ReturnType<typeof createHash>;
    });
    try {
      expect(() => guardResponsesToolNames(request([`${prefix}.one`, `${prefix}.two`])))
        .toThrow(new ResponsesToolNameCollisionError(`${prefix}_0123456789`));
    } finally {
      jest.mocked(createHash).mockImplementation(
        jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash);
    }
  });

  it.each([
    ['after the aliased tool', (alias: string) => [LONG_MCP, alias]],
    ['before the aliased tool', (alias: string) => [alias, LONG_MCP]],
  ])('throws when an alias equals another tool original name (%s)', (_order, tools) => {
    const alias = expectedAlias(LONG_MCP);
    let caught: unknown;
    try { guardResponsesToolNames(request(tools(alias))); } catch (error: unknown) { caught = error; }
    expect(caught).toBeInstanceOf(ResponsesToolNameCollisionError);
    expect(caught).toMatchObject({ alias, name: 'ResponsesToolNameCollisionError',
      message: `Tool name collision after Responses name normalization: ${alias}` });
  });

  it('throws when a history name equals an alias', () => {
    const alias = expectedAlias(LONG_MCP);
    expect(() => guardResponsesToolNames(request([LONG_MCP], [call('c1', alias)])))
      .toThrow(ResponsesToolNameCollisionError);
  });

  it('does not treat a repeated invalid name as a collision', () => {
    expect(() => guardResponsesToolNames(request([LONG_MCP, LONG_MCP], [call('c1', LONG_MCP)]))).not.toThrow();
  });

  describe('replay pairing of a translated multi-turn request', () => {
    const anthropic: AnthropicMessagesRequest = {
      model: 'gpt-5.4',
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: 'user', content: 'use the tool' },
        { role: 'assistant', content: [
          { type: 'text', text: 'calling' },
          { type: 'tool_use', id: 'call_long', name: LONG_MCP, input: { q: 'one' } },
          { type: 'tool_use', id: 'call_read', name: 'Read', input: { path: 'a' } },
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'call_long', content: 'long result' },
          { type: 'tool_result', tool_use_id: 'call_read', content: 'read result' },
        ] },
        { role: 'assistant', content: [
          { type: 'tool_use', id: 'call_long_2', name: LONG_MCP, input: { q: 'two' } },
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'call_long_2', content: 'second result' },
        ] },
      ],
      tools: [
        { name: LONG_MCP, description: 'long', input_schema: { type: 'object' } },
        { name: 'Read', description: 'read', input_schema: { type: 'object' } },
      ],
    };

    it('keeps call_id pairs, uses the tools[] alias, and preserves order', () => {
      const translated = translateAnthropicToResponses(anthropic);
      const { request: out, toOriginalName } = guardResponsesToolNames(translated);
      const alias = out.tools?.[0]?.name;
      expect(alias).toBe(expectedAlias(LONG_MCP));

      // Same items in the same order; only function_call names differ.
      expect(out.input).toHaveLength(translated.input.length);
      out.input.forEach((item, index) => {
        const before = translated.input[index];
        if ('type' in item && item.type === 'function_call') {
          const original = (before as ResponsesFunctionCallItem).name;
          expect(item).toEqual({ ...before, name: original === LONG_MCP ? alias : original });
          expect(toOriginalName(item.name)).toBe(original);
        } else {
          expect(item).toBe(before);
        }
      });

      const calls = out.input.filter((item): item is ResponsesFunctionCallItem =>
        'type' in item && item.type === 'function_call');
      const outputs = out.input.filter((item): item is ResponsesFunctionCallOutputItem =>
        'type' in item && item.type === 'function_call_output');
      expect(calls.map((item) => [item.call_id, item.name]))
        .toEqual([['call_long', alias], ['call_read', 'Read'], ['call_long_2', alias]]);
      expect(outputs.map((item) => item.call_id)).toEqual(['call_long', 'call_read', 'call_long_2']);
      for (const item of calls) {
        const outputIndex = out.input.findIndex((candidate) =>
          'type' in candidate && candidate.type === 'function_call_output' && candidate.call_id === item.call_id);
        expect(outputIndex).toBeGreaterThan(out.input.indexOf(item));
      }
    });
  });
});
