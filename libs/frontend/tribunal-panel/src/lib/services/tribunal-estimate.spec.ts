import { estimateTurns } from './tribunal-estimate';
import { RELAY_ROLES } from '../types/tribunal-ui.types';

describe('estimateTurns', () => {
  describe('flat moves — byte-identical to the previous per-vendor map', () => {
    // The old estimator was `laneCount * TURNS_PER_VENDOR[move] + 1` with
    // council: 2, forge: 3, race: 3. These numbers must not move, or AC-1.4's
    // byte-identical guarantee stops extending to the displayed estimate.
    it.each([
      ['council' as const, 1, 3],
      ['council' as const, 3, 7],
      ['council' as const, 8, 17],
      ['forge' as const, 1, 4],
      ['forge' as const, 3, 10],
      ['race' as const, 1, 4],
      ['race' as const, 3, 10],
    ])('%s with %i lanes costs %i turns', (move, lanes, expected) => {
      expect(estimateTurns(move, lanes, 2)).toBe(expected);
    });

    it('ignores roundCap for the flat moves', () => {
      expect(estimateTurns('council', 3, 1)).toBe(
        estimateTurns('council', 3, 4),
      );
    });
  });

  describe('relay — per phase, not per lane', () => {
    it('costs one call per phase plus the conductor', () => {
      expect(estimateTurns('relay', 4, 2)).toBe(RELAY_ROLES.length + 1);
      expect(estimateTurns('relay', 4, 2)).toBe(5);
    });

    it('does not scale with lane count', () => {
      // relay.md:116 — one paid call per PHASE. Extra lanes buy nothing.
      expect(estimateTurns('relay', 1, 2)).toBe(estimateTurns('relay', 8, 2));
    });
  });

  describe('crucible — two paid calls per round', () => {
    it('costs 2*(1+roundCap)+1 at the default cap of 2', () => {
      expect(estimateTurns('crucible', 2, 2)).toBe(7);
    });

    it('scales with the round cap, not the lane count', () => {
      expect(estimateTurns('crucible', 2, 1)).toBe(5);
      expect(estimateTurns('crucible', 2, 2)).toBe(7);
      expect(estimateTurns('crucible', 8, 2)).toBe(7);
    });
  });

  describe('exhaustiveness', () => {
    it('returns a finite number for every move — no arm falls through', () => {
      for (const move of [
        'council',
        'forge',
        'race',
        'relay',
        'crucible',
      ] as const) {
        const turns = estimateTurns(move, 2, 2);
        expect(Number.isFinite(turns)).toBe(true);
        expect(turns).toBeGreaterThan(0);
      }
    });
  });
});
