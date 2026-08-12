/**
 * The verdict contract's non-behavioural half.
 *
 * `SESSION_VERDICT_JSON_SCHEMA` is the `outputFormat` schema the SDK constrains
 * the archaeologist's reply with. It is real shipped configuration, not a type —
 * a wrong `enum` list there produces a model reply the store then rejects, which
 * surfaces as a mysterious degraded verdict rather than a schema error. So the
 * schema is pinned against the same TypeScript unions the store enforces.
 *
 * The single most important assertion in this file is that every nullable
 * verdict field admits `null` IN THE SCHEMA. If the model cannot SAY "I could
 * not determine the intent", it will invent one — which is the judge's
 * fabricated `score: 10` wearing a different costume, and the whole reason this
 * phase exists.
 */
import {
  EVIDENCE_CLASSES,
  FRICTION_KINDS,
  SESSION_VERDICT_DEGRADED_REASONS,
  SESSION_VERDICT_JSON_SCHEMA,
  isEvidenceClass,
} from './session-verdict.types';

function properties(schema: unknown): Record<string, Record<string, unknown>> {
  return (schema as { properties: Record<string, Record<string, unknown>> })
    .properties;
}

describe('EvidenceClass', () => {
  it('has exactly the five members plan §2.4 pins into migration 0034', () => {
    expect([...EVIDENCE_CLASSES]).toEqual([
      'tests-green',
      'user-accepted',
      'no-correction',
      'explicit-confirmation',
      'unverified',
    ]);
  });

  it('accepts every member and rejects near-misses', () => {
    for (const member of EVIDENCE_CLASSES) {
      expect(isEvidenceClass(member)).toBe(true);
    }
    // Spelling variants are the realistic failure — an LLM writes `tests_green`
    // or `TESTS-GREEN` far more often than it invents a new class.
    for (const bogus of [
      'tests_green',
      'TESTS-GREEN',
      'success',
      '',
      null,
      7,
    ]) {
      expect(isEvidenceClass(bogus)).toBe(false);
    }
  });
});

describe('degraded reasons', () => {
  it('spells the two phase-2 reasons the way the specs assert them', () => {
    // Documented, not enforced — the vocabulary is deliberately open (phases 3
    // and 4 add failure modes). These constants exist so nobody invents
    // `noQueryPath` beside `no-query-path`.
    expect(SESSION_VERDICT_DEGRADED_REASONS.NO_QUERY_PATH).toBe(
      'no-query-path',
    );
    expect(SESSION_VERDICT_DEGRADED_REASONS.TOOL_USE_UNSUPPORTED).toBe(
      'tool-use-unsupported',
    );
  });
});

describe('SESSION_VERDICT_JSON_SCHEMA', () => {
  const props = properties(SESSION_VERDICT_JSON_SCHEMA);

  it('is a JSON-Schema object requiring the five verdict fields', () => {
    expect(SESSION_VERDICT_JSON_SCHEMA['type']).toBe('object');
    expect(SESSION_VERDICT_JSON_SCHEMA['required']).toEqual([
      'intent',
      'outcome',
      'evidenceClass',
      'frictionMap',
      'routine',
    ]);
  });

  it('lets the model answer null for intent, outcome, evidenceClass and routine', () => {
    // THE assertion this file exists for. A model that cannot say "I do not
    // know" fabricates — see the judge's `score: 10`.
    expect(props['intent']['type']).toEqual(['string', 'null']);
    expect(props['outcome']['type']).toEqual(['string', 'null']);
    expect(props['evidenceClass']['type']).toEqual(['string', 'null']);
    expect(props['routine']['type']).toEqual(['object', 'null']);
  });

  it('constrains evidenceClass to the union plus null', () => {
    expect(props['evidenceClass']['enum']).toEqual([...EVIDENCE_CLASSES, null]);
  });

  it('constrains friction kinds to the union', () => {
    const items = props['frictionMap']['items'] as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(items.properties['kind']['enum']).toEqual([...FRICTION_KINDS]);
    expect(items.required).toEqual(['turnIndex', 'kind', 'note']);
  });

  it('demands INTEGER turn indices everywhere a turn is cited', () => {
    // The store rejects a fractional index; asking the model for an integer up
    // front is what stops that rejection from being the common case.
    const frictionItems = props['frictionMap']['items'] as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(frictionItems.properties['turnIndex']['type']).toBe('integer');
    expect(frictionItems.properties['turnIndex']['minimum']).toBe(0);

    const routineProps = props['routine']['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(routineProps['citations']['items']).toEqual({
      type: 'integer',
      minimum: 0,
    });
    expect(routineProps['citations']['type']).toBe('array');

    const turnRanges = props['requestTurns']['items'] as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(turnRanges.properties['from']['type']).toBe('integer');
    expect(turnRanges.properties['to']['type']).toBe('integer');
    expect(turnRanges.required).toEqual(['from', 'to']);
  });

  it('makes the retrieval requests OPTIONAL — their absence is what ends the loop', () => {
    const required = SESSION_VERDICT_JSON_SCHEMA['required'] as string[];
    expect(required).not.toContain('requestTurns');
    expect(required).not.toContain('requestSearch');
    expect(props['requestTurns']['type']).toBe('array');
    expect(props['requestSearch']['type']).toBe('array');
  });

  it('tells the model not to echo the first message', () => {
    // The regex extractor this phase demotes could only ever quote the opening
    // message. Encoding "do not echo it" in the schema description is how the
    // replacement avoids reproducing the defect it exists to fix.
    expect(String(props['intent']['description'])).toMatch(
      /do NOT echo the first message/i,
    );
  });
});
