import { encode } from 'gpt-tokenizer';

import { convertPtahUi } from './ptah-ui-converter';
import { PTAH_UI_CORPUS } from './ptah-ui.corpus';
import { parsePtahUi } from './ptah-ui-parser';

describe('ptah-ui corpus compactness', () => {
  it.each(PTAH_UI_CORPUS)(
    '$name uses fewer tokens than its unresolved conversion JSON',
    ({ body }) => {
      const parsed = parsePtahUi(body);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      // Req 5.13 compares the canonical fence body and compact, unresolved converter JSON.
      const fenceTokens = encode(body).length;
      const jsonTokens = encode(
        JSON.stringify(convertPtahUi(parsed.doc, 'ptah-ui-corpus')),
      ).length;
      expect(fenceTokens).toBeLessThan(jsonTokens);
    },
  );
});
