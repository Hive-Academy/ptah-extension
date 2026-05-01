/**
 * tool-parameters — type shape specs (P1.B8, TASK_2026_100).
 *
 * `tool-parameters.ts` declares six interfaces describing the LM tool
 * parameter contracts that VS Code passes to Ptah tools. There is no runtime
 * code to exercise — the value of these tests is structural: they pin down
 * which fields are optional vs required, catch edge cases (empty strings,
 * nulls, deeply nested objects), and give a regression signal if anyone
 * widens/narrows the contract.
 *
 * Strategy:
 *   1. Compile-time assertions via helper `expectType<T, U>()` that fail to
 *      compile if the inferred object shape drifts from the declared one.
 *   2. Runtime assertions that validate the pragmatic edge cases listed in
 *      the Phase 2 plan (empty strings, null-equivalent missing fields,
 *      deeply nested optional payloads).
 */

import type {
  IAnalyzeWorkspaceParameters,
  ISearchFilesParameters,
  IOptimizeContextParameters,
  IGetRelevantFilesParameters,
  IGetProjectStructureParameters,
  IGetDiagnosticsParameters,
} from './tool-parameters';

// A compile-time "equal" helper. If the two types aren't mutually assignable,
// `Equals<A, B>` resolves to `false` and the `true as Equals<A, B>` line
// becomes a type error — caught by `tsc` under `nx test`.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

function assert<T extends true>(_value: T): void {
  /* compile-time only */
}

describe('IAnalyzeWorkspaceParameters', () => {
  it('accepts an empty object (all fields optional)', () => {
    const params: IAnalyzeWorkspaceParameters = {};
    expect(params).toEqual({});
  });

  it('accepts includeHidden=true and includeHidden=false', () => {
    const a: IAnalyzeWorkspaceParameters = { includeHidden: true };
    const b: IAnalyzeWorkspaceParameters = { includeHidden: false };
    expect(a.includeHidden).toBe(true);
    expect(b.includeHidden).toBe(false);
  });

  it('locks the shape at compile time', () => {
    assert<Equals<IAnalyzeWorkspaceParameters, { includeHidden?: boolean }>>(
      true,
    );
  });
});

describe('ISearchFilesParameters', () => {
  it('requires query but permits optional includeImages and maxResults', () => {
    const minimal: ISearchFilesParameters = { query: 'needle' };
    const full: ISearchFilesParameters = {
      query: 'needle',
      includeImages: true,
      maxResults: 50,
    };
    expect(minimal.query).toBe('needle');
    expect(full.maxResults).toBe(50);
  });

  it('allows an empty string as a (pathological but valid) query', () => {
    const params: ISearchFilesParameters = { query: '' };
    expect(params.query).toBe('');
  });

  it('allows maxResults=0 as a boundary value', () => {
    const params: ISearchFilesParameters = { query: 'x', maxResults: 0 };
    expect(params.maxResults).toBe(0);
  });

  it('locks the shape at compile time', () => {
    assert<
      Equals<
        ISearchFilesParameters,
        { query: string; includeImages?: boolean; maxResults?: number }
      >
    >(true);
  });
});

describe('IOptimizeContextParameters', () => {
  it('requires both currentTokens and targetTokens', () => {
    const params: IOptimizeContextParameters = {
      currentTokens: 10_000,
      targetTokens: 4_000,
    };
    expect(params.currentTokens).toBe(10_000);
    expect(params.targetTokens).toBe(4_000);
  });

  it('accepts zero-valued token counts (edge case for empty buffers)', () => {
    const params: IOptimizeContextParameters = {
      currentTokens: 0,
      targetTokens: 0,
    };
    expect(params).toEqual({ currentTokens: 0, targetTokens: 0 });
  });

  it('locks the shape at compile time', () => {
    assert<
      Equals<
        IOptimizeContextParameters,
        { currentTokens: number; targetTokens: number }
      >
    >(true);
  });
});

describe('IGetRelevantFilesParameters', () => {
  it('requires taskDescription; conversationContext is optional', () => {
    const minimal: IGetRelevantFilesParameters = {
      taskDescription: 'fix login bug',
    };
    const full: IGetRelevantFilesParameters = {
      taskDescription: 'fix login bug',
      conversationContext: 'user asked about auth',
    };
    expect(minimal.conversationContext).toBeUndefined();
    expect(full.conversationContext).toBe('user asked about auth');
  });

  it('accepts multi-line / deeply nested context strings', () => {
    const context = JSON.stringify({
      messages: [
        { role: 'user', content: { text: 'hi', meta: { tags: ['a', 'b'] } } },
        { role: 'assistant', content: { text: 'hello' } },
      ],
    });
    const params: IGetRelevantFilesParameters = {
      taskDescription: 'summarize',
      conversationContext: context,
    };
    expect(
      JSON.parse(params.conversationContext as string).messages,
    ).toHaveLength(2);
  });

  it('allows empty taskDescription (consumers must validate non-empty themselves)', () => {
    const params: IGetRelevantFilesParameters = { taskDescription: '' };
    expect(params.taskDescription).toBe('');
  });

  it('locks the shape at compile time', () => {
    assert<
      Equals<
        IGetRelevantFilesParameters,
        { taskDescription: string; conversationContext?: string }
      >
    >(true);
  });
});

describe('IGetProjectStructureParameters', () => {
  it('accepts an empty object (both fields optional)', () => {
    const params: IGetProjectStructureParameters = {};
    expect(params).toEqual({});
  });

  it('allows maxDepth=0 and maxDepth=Number.MAX_SAFE_INTEGER', () => {
    const shallow: IGetProjectStructureParameters = { maxDepth: 0 };
    const unbounded: IGetProjectStructureParameters = {
      maxDepth: Number.MAX_SAFE_INTEGER,
    };
    expect(shallow.maxDepth).toBe(0);
    expect(unbounded.maxDepth).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('allows combining both optional fields', () => {
    const params: IGetProjectStructureParameters = {
      maxDepth: 3,
      includeHidden: true,
    };
    expect(params).toEqual({ maxDepth: 3, includeHidden: true });
  });

  it('locks the shape at compile time', () => {
    assert<
      Equals<
        IGetProjectStructureParameters,
        { maxDepth?: number; includeHidden?: boolean }
      >
    >(true);
  });
});

describe('IGetDiagnosticsParameters', () => {
  it('accepts an empty object (both fields optional)', () => {
    const params: IGetDiagnosticsParameters = {};
    expect(params).toEqual({});
  });

  it('accepts each valid severity literal (error/warning/info/hint)', () => {
    const severities: Array<IGetDiagnosticsParameters['severity']> = [
      'error',
      'warning',
      'info',
      'hint',
    ];
    for (const severity of severities) {
      const params: IGetDiagnosticsParameters = { severity };
      expect(params.severity).toBe(severity);
    }
  });

  it('accepts a filePath without severity', () => {
    const params: IGetDiagnosticsParameters = { filePath: 'src/a.ts' };
    expect(params.filePath).toBe('src/a.ts');
    expect(params.severity).toBeUndefined();
  });

  it('accepts an empty filePath as an edge case', () => {
    const params: IGetDiagnosticsParameters = { filePath: '' };
    expect(params.filePath).toBe('');
  });

  it('locks the severity enum at compile time', () => {
    assert<
      Equals<
        IGetDiagnosticsParameters,
        {
          filePath?: string;
          severity?: 'error' | 'warning' | 'info' | 'hint';
        }
      >
    >(true);
  });
});
