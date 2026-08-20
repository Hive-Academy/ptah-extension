/**
 * WebFetch / WebSearch tool-payload guards.
 *
 * These narrow AI tool arguments and results — data the model produced, not
 * data we control. Every guard is the last check before a consumer reads
 * `input.url` and hands it to a fetcher, or maps over `output.results`. A
 * guard that is too loose turns a malformed tool call into a `TypeError` deep
 * in a renderer; one that is too tight silently drops a legitimate result.
 */
import {
  isWebFetchToolInput,
  isWebFetchToolOutput,
  isWebSearchToolInput,
  isWebSearchToolOutput,
} from './net';

/** Values that are never a valid tool payload, whatever the tool. */
const NON_OBJECTS: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['a string', 'url'],
  ['a number', 42],
  ['a boolean', true],
];

describe('isWebFetchToolInput', () => {
  it('accepts a complete input', () => {
    expect(
      isWebFetchToolInput({ url: 'https://example.com', prompt: 'summarise' }),
    ).toBe(true);
  });

  it('accepts extra properties — tool schemas grow', () => {
    expect(
      isWebFetchToolInput({
        url: 'https://example.com',
        prompt: 'summarise',
        timeout: 30,
      }),
    ).toBe(true);
  });

  it.each([
    ['url missing', { prompt: 'summarise' }],
    ['prompt missing', { url: 'https://example.com' }],
    ['url not a string', { url: 123, prompt: 'summarise' }],
    ['prompt not a string', { url: 'https://example.com', prompt: null }],
    ['both empty object', {}],
  ])('rejects when %s', (_label, input) => {
    expect(isWebFetchToolInput(input)).toBe(false);
  });

  it.each(NON_OBJECTS)('rejects %s', (_label, value) => {
    expect(isWebFetchToolInput(value)).toBe(false);
  });

  it('accepts empty strings — emptiness is the caller’s business, not the shape’s', () => {
    expect(isWebFetchToolInput({ url: '', prompt: '' })).toBe(true);
  });
});

describe('isWebSearchToolInput', () => {
  it('accepts a query-only input, since the domain filters are optional', () => {
    expect(isWebSearchToolInput({ query: 'ptah' })).toBe(true);
  });

  it('accepts an input carrying both domain filters', () => {
    expect(
      isWebSearchToolInput({
        query: 'ptah',
        allowed_domains: ['example.com'],
        blocked_domains: ['spam.example'],
      }),
    ).toBe(true);
  });

  it.each([
    ['query missing', { allowed_domains: ['example.com'] }],
    ['query not a string', { query: ['ptah'] }],
    ['empty object', {}],
  ])('rejects when %s', (_label, input) => {
    expect(isWebSearchToolInput(input)).toBe(false);
  });

  it.each(NON_OBJECTS)('rejects %s', (_label, value) => {
    expect(isWebSearchToolInput(value)).toBe(false);
  });
});

describe('isWebFetchToolOutput', () => {
  it('accepts the two required fields', () => {
    expect(
      isWebFetchToolOutput({
        response: 'a summary',
        url: 'https://example.com',
      }),
    ).toBe(true);
  });

  it('accepts the optional redirect and status fields', () => {
    expect(
      isWebFetchToolOutput({
        response: 'a summary',
        url: 'https://example.com',
        final_url: 'https://example.com/en',
        status_code: 200,
      }),
    ).toBe(true);
  });

  it.each([
    ['response missing', { url: 'https://example.com' }],
    ['url missing', { response: 'a summary' }],
    ['empty object', {}],
  ])('rejects when %s', (_label, output) => {
    expect(isWebFetchToolOutput(output)).toBe(false);
  });

  it.each(NON_OBJECTS)('rejects %s', (_label, value) => {
    expect(isWebFetchToolOutput(value)).toBe(false);
  });
});

describe('isWebSearchToolOutput', () => {
  it('accepts a well-formed result set', () => {
    expect(
      isWebSearchToolOutput({
        results: [{ title: 't', url: 'u', snippet: 's' }],
        total_results: 1,
        query: 'ptah',
      }),
    ).toBe(true);
  });

  it('accepts an empty result list — no hits is a valid answer', () => {
    expect(
      isWebSearchToolOutput({ results: [], total_results: 0, query: 'ptah' }),
    ).toBe(true);
  });

  it('rejects results that are not an array', () => {
    // The consumer maps over this; a non-array is the crash this guard exists
    // to prevent.
    expect(
      isWebSearchToolOutput({ results: { title: 't' }, query: 'ptah' }),
    ).toBe(false);
    expect(isWebSearchToolOutput({ results: null, query: 'ptah' })).toBe(false);
  });

  it.each([
    ['results missing', { total_results: 0, query: 'ptah' }],
    ['query missing', { results: [], total_results: 0 }],
    ['empty object', {}],
  ])('rejects when %s', (_label, output) => {
    expect(isWebSearchToolOutput(output)).toBe(false);
  });

  it.each(NON_OBJECTS)('rejects %s', (_label, value) => {
    expect(isWebSearchToolOutput(value)).toBe(false);
  });
});
