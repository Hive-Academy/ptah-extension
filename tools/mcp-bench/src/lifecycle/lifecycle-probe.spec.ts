import type { McpToolCaller, ToolCallOutcome } from '../transport/mcp-client';
import { searchSymbol } from './lifecycle-probe';

const ROOT = 'D:/corpus';
const FILE = 'libs/x/a.ts';

const result = (text: string, isError = false): ToolCallOutcome => ({
  kind: 'result',
  text,
  isError,
  wallMs: 1,
});

function caller(outcome: ToolCallOutcome): McpToolCaller {
  return { callTool: async () => outcome };
}

/** The shape `ptah_code_search_symbols` writes, with one hit. */
function symbolText(
  filePath: string,
  coverage: Record<string, unknown>,
  symbolName = 'foo',
): string {
  return JSON.stringify({
    index: { symbolCount: 4, reindexInFlight: true },
    coverage,
    bm25Only: false,
    hits: [
      {
        subject: 'foo',
        filePath,
        symbolName,
        kind: 'function',
        text: 'export function foo',
        score: 0.02,
      },
    ],
  });
}

const UNKNOWN_COVERAGE = {
  clean: false,
  reasons: ['census?', 'unchecked?', 'failed?'],
  census: 'unknown',
};

describe('searchSymbol', () => {
  const callerFor = (outcome: ToolCallOutcome) =>
    searchSymbol(caller(outcome), ROOT, 'foo', FILE);

  it('counts the expected file under unknown coverage and stays errored', async () => {
    const probe = await callerFor(
      result(symbolText(`${ROOT}/${FILE}`, UNKNOWN_COVERAGE)),
    );
    expect(probe).toMatchObject({
      found: true,
      errored: true,
      hits: 1,
      underUnknownCoverage: true,
    });
    expect(probe.state).toBe(
      'unknown-coverage {"symbolCount":4,"reindexInFlight":true}',
    );
  });

  it('does not count a miss under unknown coverage', async () => {
    const probe = await callerFor(
      result(symbolText(`${ROOT}/libs/x/other.ts`, UNKNOWN_COVERAGE)),
    );
    expect(probe).toMatchObject({
      found: false,
      errored: true,
      hits: 1,
      underUnknownCoverage: false,
    });
    expect(probe.state.startsWith('unknown-coverage ')).toBe(true);
  });

  it('leaves a clean hit unchanged', async () => {
    const probe = await callerFor(
      result(symbolText(`${ROOT}/${FILE}`, { clean: true })),
    );
    expect(probe).toMatchObject({
      found: true,
      errored: false,
      hits: 1,
      underUnknownCoverage: false,
    });
    expect(probe.state.startsWith('ok ')).toBe(true);
  });

  it('does not count a different symbol from the expected file', async () => {
    const probe = await callerFor(
      result(symbolText(`${ROOT}/${FILE}`, { clean: true }, 'oldFoo')),
    );
    expect(probe).toMatchObject({
      found: false,
      errored: false,
      hits: 1,
      underUnknownCoverage: false,
    });
  });

  it('counts a class-qualified method name in the expected file', async () => {
    const probe = await searchSymbol(
      caller(
        result(
          symbolText(
            `${ROOT}/${FILE}`,
            { clean: true },
            'ProviderSetupWizardComponent.onKeepEditing',
          ),
        ),
      ),
      ROOT,
      'onKeepEditing',
      FILE,
    );
    expect(probe.found).toBe(true);
  });

  it.each(['Other.onKeepEditingX', 'onKeepEditingX', 'differentSymbol'])(
    'does not count a non-matching method name: %s',
    async (symbolName) => {
      const probe = await searchSymbol(
        caller(
          result(symbolText(`${ROOT}/${FILE}`, { clean: true }, symbolName)),
        ),
        ROOT,
        'onKeepEditing',
        FILE,
      );
      expect(probe.found).toBe(false);
    },
  );

  it('does not read hits for building or tool-error', async () => {
    const building = await callerFor(
      result(
        JSON.stringify({
          status: 'building',
          retryAfterMs: 500,
          index: { symbolCount: 1 },
          hits: [
            {
              filePath: `${ROOT}/${FILE}`,
              symbolName: 'foo',
              kind: 'function',
              text: 'export function foo',
              score: 0.02,
            },
          ],
        }),
      ),
    );
    expect(building).toMatchObject({
      found: false,
      errored: true,
      hits: 0,
      underUnknownCoverage: false,
    });
    expect(building.state.startsWith('building')).toBe(true);

    const toolError = await callerFor(
      result(symbolText(`${ROOT}/${FILE}`, UNKNOWN_COVERAGE), true),
    );
    expect(toolError).toMatchObject({
      found: false,
      errored: true,
      hits: 0,
      underUnknownCoverage: false,
    });
    expect(toolError.state.startsWith('tool-error')).toBe(true);
  });

  it('stays a non-hit when unknown coverage text does not parse', async () => {
    const probe = await callerFor(
      result(
        '{"index":{"symbolCount":1},"coverage":{"census":"unknown","reasons":["census?"]},"hits":"nope"}',
      ),
    );
    expect(probe).toMatchObject({
      found: false,
      errored: true,
      hits: 0,
      underUnknownCoverage: false,
    });
    expect(probe.state.startsWith('parse: ')).toBe(true);
  });
});
