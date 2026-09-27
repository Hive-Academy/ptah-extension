import * as ts from 'typescript';
import {
  coversOffset,
  detachedMarker,
  parseMarkerComment,
  tsMarkers,
} from './markers';

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

  it('reads rtl-exempt and i18n-format-exempt reasons from TS, HTML and CSS comments', () => {
    expect(parseMarkerComment('// rtl-exempt: decorative cube')).toEqual({
      kind: 'rtl-exempt',
      tokens: [],
      reason: 'decorative cube',
    });
    expect(parseMarkerComment('<!-- rtl-exempt: fixed seam -->')).toEqual(
      expect.objectContaining({ kind: 'rtl-exempt', reason: 'fixed seam' }),
    );
    expect(parseMarkerComment('/* rtl-exempt: */')).toEqual(
      expect.objectContaining({ kind: 'rtl-exempt', reason: '' }),
    );
    expect(
      parseMarkerComment('// i18n-format-exempt: time zone read, not output'),
    ).toEqual({
      kind: 'format-exempt',
      tokens: [],
      reason: 'time zone read, not output',
    });
  });

  it('does not read a marker name inside a longer word', () => {
    expect(parseMarkerComment('// not-rtl-exempt: x')).toBeNull();
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

  it('attaches rtl-exempt like every other marker', () => {
    const text = [
      'const stages = [',
      '  // rtl-exempt: data-driven diagram position',
      '  {',
      '    left: 50,',
      '  },',
      '  { left: 20 },',
      '];',
    ].join('\n');
    const [marker] = markersOf(text);
    expect(marker.kind).toBe('rtl-exempt');
    expect(coversOffset(marker, offsetOf(text, 'left: 50'))).toBe(true);
    expect(coversOffset(marker, offsetOf(text, 'left: 20'))).toBe(false);
  });

  it('finds a marker before a closing brace, attached to nothing', () => {
    const text =
      'class C {\n  readonly x = 1;\n  // rtl-exempt: nothing follows\n}';
    expect(markersOf(text).map((m) => [m.kind, m.line, m.covers])).toEqual([
      ['rtl-exempt', 3, null],
    ]);
  });

  it('ignores marker text inside template literals', () => {
    expect(markersOf('const t = `<!-- i18n-keys: a.b.c -->`;')).toEqual([]);
  });
});

describe('detachedMarker', () => {
  it('reports a marker that covers nothing, naming its kind', () => {
    const [trailing, attached] = markersOf(
      'const a = 1; // i18n-format-exempt: trailing\n// rtl-exempt: above\nconst b = 2;',
    );
    expect(detachedMarker(trailing)).toEqual({
      file: 'c.ts',
      line: 1,
      kind: 'detached-marker',
      key: '',
      detail:
        'this i18n-format-exempt: marker attaches to nothing; put the marker on its own line directly above the code',
    });
    expect(detachedMarker(attached)).toBeNull();
  });
});
