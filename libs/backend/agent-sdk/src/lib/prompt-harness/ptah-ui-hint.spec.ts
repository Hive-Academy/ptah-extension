import { encode } from 'gpt-tokenizer';
import { parsePtahUi } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { PTAH_UI_HINT } from './ptah-ui-hint';

describe('PTAH_UI_HINT', () => {
  it('stays within the 100-token budget', () => {
    expect(encode(PTAH_UI_HINT).length).toBeLessThanOrEqual(100);
  });

  it('points to the on-demand skill without advertising deferred elements', () => {
    expect(PTAH_UI_HINT).toContain('ptah-surface-authoring');
    expect(PTAH_UI_HINT).not.toMatch(/note/i);
  });

  it('uses only parseable ptah-ui examples', () => {
    const examples = Array.from(
      PTAH_UI_HINT.matchAll(/```ptah-ui\n([\s\S]*?)\n```/g),
      (match) => match[1],
    );

    expect(examples).not.toHaveLength(0);
    for (const example of examples) {
      expect(parsePtahUi(example).ok).toBe(true);
    }
  });
});
