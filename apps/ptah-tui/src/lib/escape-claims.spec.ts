import {
  NO_ESCAPE_CLAIMS,
  addEscapeClaim,
  isEscapeClaimed,
  removeEscapeClaim,
} from './escape-claims.js';

describe('escape claims', () => {
  it('is unclaimed when empty', () => {
    expect(isEscapeClaimed(NO_ESCAPE_CLAIMS)).toBe(false);
  });

  it('claims and releases one surface', () => {
    const held = addEscapeClaim(NO_ESCAPE_CLAIMS, 'sidebar.delete-confirm');
    expect(isEscapeClaimed(held)).toBe(true);
    expect(
      isEscapeClaimed(removeEscapeClaim(held, 'sidebar.delete-confirm')),
    ).toBe(false);
  });

  it('stays claimed while any other surface still holds one', () => {
    let claims = addEscapeClaim(NO_ESCAPE_CLAIMS, 'a');
    claims = addEscapeClaim(claims, 'b');
    claims = removeEscapeClaim(claims, 'a');
    expect(isEscapeClaimed(claims)).toBe(true);
    expect(isEscapeClaimed(removeEscapeClaim(claims, 'b'))).toBe(false);
  });

  it('does not drift upward on a repeated claim', () => {
    // A counter would reach 2 here and never return to 0, disabling Escape for
    // the rest of the session. Note what carries this: `removeEscapeClaim`
    // filters *every* copy of the id, so it holds even if the dedupe in
    // `addEscapeClaim` were removed. The dedupe earns its place by keeping
    // array identity stable, which the next test pins — do not read this one
    // as covering it.
    let claims = addEscapeClaim(NO_ESCAPE_CLAIMS, 'a');
    claims = addEscapeClaim(claims, 'a');
    expect(isEscapeClaimed(removeEscapeClaim(claims, 'a'))).toBe(false);
  });

  it('ignores a release with no matching claim', () => {
    const claims = addEscapeClaim(NO_ESCAPE_CLAIMS, 'a');
    expect(removeEscapeClaim(claims, 'never-claimed')).toBe(claims);
    expect(removeEscapeClaim(NO_ESCAPE_CLAIMS, 'a')).toBe(NO_ESCAPE_CLAIMS);
  });

  it('returns the same array when nothing changes, so React can bail out', () => {
    const claims = addEscapeClaim(NO_ESCAPE_CLAIMS, 'a');
    expect(addEscapeClaim(claims, 'a')).toBe(claims);
  });
});
