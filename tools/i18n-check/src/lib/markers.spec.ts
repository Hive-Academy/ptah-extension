import * as ts from 'typescript';
import { coversOffset, parseMarkerComment, tsMarkers } from './markers';

const markersOf = (text: string) =>
  tsMarkers(
    ts.createSourceFile('c.ts', text, ts.ScriptTarget.ESNext, true),
    'c.ts',
  );

describe('parseMarkerComment', () => {
  it('reads i18n-keys tokens from TS and HTML comments', () => {
    expect(
      parseMarkerComment('// i18n-keys: core.a.b core.checkout.*'),
    ).toEqual({
      kind: 'keys',
      tokens: ['core.a.b', 'core.checkout.*'],
      reason: '',
    });
    expect(parseMarkerComment(' i18n-keys: ui.nav.home ')).toEqual(
      expect.objectContaining({ tokens: ['ui.nav.home'] }),
    );
    expect(parseMarkerComment('// i18n-keys:')).toEqual(
      expect.objectContaining({ kind: 'keys', tokens: [] }),
    );
  });

  it('reads i18n-ignore reasons, empty when missing', () => {
    expect(parseMarkerComment('// i18n-ignore: doc example')).toEqual({
      kind: 'ignore',
      tokens: [],
      reason: 'doc example',
    });
    expect(parseMarkerComment('/* i18n-ignore: */')).toEqual(
      expect.objectContaining({ kind: 'ignore', reason: '' }),
    );
    expect(parseMarkerComment('// an ordinary comment')).toBeNull();
  });
});

describe('tsMarkers', () => {
  const offsetOf = (text: string, needle: string) => text.indexOf(needle);

  it('covers the whole next statement, across wrapped lines', () => {
    const text = [
      'function f() {',
      '  // i18n-keys: core.checkout.*',
      '  return translate(',
      '    this.checkoutMessage.key,',
      '    { reason: 1 },',
      '  );',
      '}',
    ].join('\n');
    const [marker] = markersOf(text);
    expect(marker).toEqual(
      expect.objectContaining({
        kind: 'keys',
        line: 2,
        tokens: ['core.checkout.*'],
      }),
    );
    expect(coversOffset(marker, offsetOf(text, 'this.checkoutMessage'))).toBe(
      true,
    );
  });

  it('covers the whole next class property', () => {
    const text = [
      'class C {',
      '  // i18n-ignore: documentation sample',
      '  readonly sample = [',
      "    'first',",
      "    'pricing.doc.sample.path',",
      '  ];',
      '  readonly other = 1;',
      '}',
    ].join('\n');
    const [marker] = markersOf(text);
    expect(marker.kind).toBe('ignore');
    expect(coversOffset(marker, offsetOf(text, "'pricing.doc"))).toBe(true);
    expect(coversOffset(marker, offsetOf(text, 'readonly other'))).toBe(false);
  });

  it('does not reach past an unrelated sibling', () => {
    const text = [
      'class C {',
      '  // i18n-keys: core.checkout.*',
      '  readonly unrelated = 1;',
      '  readonly separated = translate(this.message.key);',
      '}',
    ].join('\n');
    const [marker] = markersOf(text);
    expect(coversOffset(marker, offsetOf(text, 'readonly unrelated'))).toBe(
      true,
    );
    expect(coversOffset(marker, offsetOf(text, 'this.message.key'))).toBe(
      false,
    );
  });

  it('attaches a trailing or final comment to nothing, but still reports it', () => {
    const text =
      'const a = 1; // i18n-keys: core.a.b\nconst b = translate(x);\n// i18n-keys: core.c.d\n';
    const markers = markersOf(text);
    expect(markers.map((m) => [m.line, m.covers])).toEqual([
      [1, null],
      [3, null],
    ]);
  });

  it('does not let a file-header marker cover the whole file', () => {
    const text =
      '// i18n-keys: core.a.b\nconst a = translate(x);\nconst b = translate(y);';
    const [marker] = markersOf(text);
    expect(coversOffset(marker, offsetOf(text, 'x)'))).toBe(true);
    expect(coversOffset(marker, offsetOf(text, 'y)'))).toBe(false);
  });

  it('ignores marker text inside template literals', () => {
    expect(markersOf('const t = `<!-- i18n-keys: a.b.c -->`;')).toEqual([]);
  });
});
