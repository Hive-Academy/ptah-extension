import { encode } from 'gpt-tokenizer';
import {
  parsePtahUi,
  segmentPtahUi,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { PTAH_UI_HINT } from './ptah-ui-hint';

/**
 * Every host source the hint must list, in the order it lists them (R8.1),
 * each with one scalar the grammar defines for it (`$usage` has no rows).
 */
const HOST_SOURCE_SCALARS = {
  diff: 'files',
  tests: 'total',
  usage: 'cost',
  agents: 'total',
  limits: 'lanes',
} as const;
const HOST_SOURCES = Object.keys(HOST_SOURCE_SCALARS) as Array<
  keyof typeof HOST_SOURCE_SCALARS
>;

describe('PTAH_UI_HINT', () => {
  it('stays within the 100-token budget', () => {
    expect(encode(PTAH_UI_HINT).length).toBeLessThanOrEqual(100);
  });

  it('points to the on-demand skill without advertising deferred elements', () => {
    expect(PTAH_UI_HINT).toContain('ptah-surface-authoring');
    expect(PTAH_UI_HINT).not.toMatch(/note/i);
  });

  it('says that the host supplies values for every available source', () => {
    expect(PTAH_UI_HINT).toContain('the host supplies');
    expect(PTAH_UI_HINT).toContain(
      HOST_SOURCES.map((source) => `$${source}`).join(' '),
    );
  });

  it('names the display target and the id-update rule', () => {
    expect(PTAH_UI_HINT).toContain('```ptah-ui display [id]');
    expect(PTAH_UI_HINT).toContain('reusing an id updates it in place');
  });

  it('keeps the session scope and row fields in the skill only (R8.3)', () => {
    expect(PTAH_UI_HINT).not.toMatch(/\bsession\b/);
    expect(PTAH_UI_HINT).not.toMatch(/\bcontext\b/);
  });

  it('future-fence guard: every ptah-ui fence the hint may contain parses (it contains none today)', () => {
    const examples = Array.from(
      PTAH_UI_HINT.matchAll(/```ptah-ui(?: display(?: \S+)?)?\n([\s\S]*?)\n```/g),
      (match) => match[1],
    );

    for (const example of examples) {
      expect(parsePtahUi(example).ok).toBe(true);
    }
  });

  it('component syntax coverage: the named display [id] opener segments as a display fence and each listed source parses as a stat value', () => {
    // The hint carries no example because R8.1 does not require one and R8.3
    // assigns worked examples to the ptah-surface-authoring skill, so the forms
    // it names are checked instead: the display opener with a concrete id, and
    // each listed source as a stat value.
    const opener = /```ptah-ui display \[id\]/.exec(PTAH_UI_HINT)?.[0];
    expect(opener).toBeDefined();
    const fence = `${(opener ?? '').replace('[id]', 'turn-stats')}\nlist $tests\n\`\`\``;
    const [segment] = segmentPtahUi(fence);
    expect(segment).toMatchObject({
      kind: 'fence',
      target: 'display',
      displayId: 'turn-stats',
    });

    for (const source of HOST_SOURCES) {
      const body = `stats\n  Value | $${source}.${HOST_SOURCE_SCALARS[source]}`;
      expect({ body, ok: parsePtahUi(body).ok }).toEqual({ body, ok: true });
    }
  });
});
