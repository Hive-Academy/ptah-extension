/**
 * Specs for the shared `parseCorpusFilter` helper — used by both
 * `KnowledgeAgentService.rebuildCorpus` and
 * `CorpusSuggestionService.loadExistingCorpora` to read the persisted
 * `corpora.query_json` blob. Pure function, no DB/native dependency, so this
 * spec runs unconditionally (not native-gated).
 */
import { parseCorpusFilter } from './corpus-filter.util';

describe('parseCorpusFilter', () => {
  it('valid JSON object → returns the parsed params', () => {
    const raw = JSON.stringify({
      name: 'auth',
      workspaceRoot: '/ws/X',
      concepts: ['auth', 'jwt'],
      limit: 100,
    });

    const result = parseCorpusFilter(raw);

    expect(result).toEqual({
      name: 'auth',
      workspaceRoot: '/ws/X',
      concepts: ['auth', 'jwt'],
      limit: 100,
    });
  });

  it('malformed (unparseable) JSON → null', () => {
    expect(parseCorpusFilter('not-json')).toBeNull();
    expect(parseCorpusFilter('{"unterminated": ')).toBeNull();
  });

  it('empty string → null', () => {
    expect(parseCorpusFilter('')).toBeNull();
  });

  it('JSON literal null → null', () => {
    expect(parseCorpusFilter('null')).toBeNull();
  });

  it('non-object primitive JSON (string, number, boolean) → null', () => {
    expect(parseCorpusFilter('"a string"')).toBeNull();
    expect(parseCorpusFilter('42')).toBeNull();
    expect(parseCorpusFilter('true')).toBeNull();
  });
});
