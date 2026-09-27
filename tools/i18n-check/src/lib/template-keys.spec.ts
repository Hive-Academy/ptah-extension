import { extractTemplateKeys } from './template-keys';

const scanOf = (
  text: string,
  file = 'x.html',
  firstLine = 1,
  firstOffset = 0,
) => extractTemplateKeys({ text, file, firstLine, firstOffset });

describe('extractTemplateKeys', () => {
  it('collects literal pipe keys from interpolations, bindings and control flow', () => {
    const template = [
      "<h1>{{ 'pricing.a.title' | transloco }}</h1>",
      '<img [alt]="\'pricing.a.alt\' | transloco" />',
      '@if (open) {',
      "  <p>{{ 'pricing.a.open' | transloco: { n: 1 } }}</p>",
      '}',
      '@for (item of items; track item) {',
      "  @let label = 'pricing.a.item' | transloco;",
      '  <span>{{ label }}</span>',
      '}',
    ].join('\n');
    const scan = scanOf(template, 'x.html', 1);
    expect(scan.violations).toEqual([]);
    expect(scan.uses.map((u) => `${u.line}:${u.form}:${u.key}`)).toEqual([
      '1:literal:pricing.a.title',
      '2:literal:pricing.a.alt',
      '4:literal:pricing.a.open',
      '7:literal:pricing.a.item',
    ]);
  });

  it('reports computed keys with their receiver identifier', () => {
    const template = [
      '{{ STATUS_I18N_KEYS[s] | transloco }}',
      '{{ this.statusI18nKeys[s] | transloco }}',
      '{{ keys().a | transloco }}',
      '{{ msg.key | transloco: msg.params }}',
      "{{ (ok ? 'a.b.c' : 'a.b.d') | transloco }}",
    ].join('\n');
    const scan = scanOf(template, 'x.html', 1);
    expect(scan.uses.map((u) => [u.form, u.key, u.receiver])).toEqual([
      ['computed', 'STATUS_I18N_KEYS[s]', 'STATUS_I18N_KEYS'],
      ['computed', 'this.statusI18nKeys[s]', 'statusI18nKeys'],
      ['computed', 'keys().a', 'keys'],
      ['computed', 'msg.key', 'msg'],
      ['computed', "(ok ? 'a.b.c' : 'a.b.d')", null],
    ]);
  });

  it('offsets lines for an inline template', () => {
    const scan = scanOf("\n  <p>{{ 'a.b.c' | transloco }}</p>", 'c.ts', 10);
    expect(scan.uses[0].line).toBe(11);
  });

  it('collects string literals, static text and attribute values for the literal scan', () => {
    const scan = scanOf(
      '<a title="legal.a.b" href="https://ptah.live">ptah.live</a>{{ f(\'x.y.z\') }}',
      'x.html',
      1,
    );
    expect(scan.strings.map((s) => s.value).sort()).toEqual([
      'https://ptah.live',
      'legal.a.b',
      'ptah.live',
      'x.y.z',
    ]);
  });

  it('ignores other pipes', () => {
    expect(scanOf("{{ 'a.b.c' | uppercase }}", 'x.html', 1).uses).toEqual([]);
  });

  it('reports a template parse failure', () => {
    const scan = scanOf('<div>\n@if (x {\n</div>', 'x.html', 1);
    expect(scan.violations.length).toBeGreaterThan(0);
    expect(scan.violations[0]).toEqual(
      expect.objectContaining({ kind: 'parse-error', file: 'x.html' }),
    );
  });

  describe('markers', () => {
    const covered = (text: string) => {
      const scan = scanOf(text);
      return scan.uses.map((u) =>
        scan.markers.some(
          (m) =>
            m.covers !== null &&
            u.offset >= m.covers.start &&
            u.offset < m.covers.end,
        ),
      );
    };

    it('covers the whole next sibling, however it is wrapped', () => {
      const text = [
        '<!-- i18n-keys: core.checkout.* -->',
        '<p class="checkout-message" data-testid="checkout-message">',
        '  {{ message.key | transloco }}',
        '</p>',
      ].join('\n');
      expect(covered(text)).toEqual([true]);
      expect(scanOf(text).markers[0]).toEqual(
        expect.objectContaining({
          kind: 'keys',
          line: 1,
          tokens: ['core.checkout.*'],
        }),
      );
    });

    it('does not reach past an unrelated sibling', () => {
      const text = [
        '<!-- i18n-keys: core.checkout.* -->',
        '<hr />',
        '<p>{{ message.key | transloco }}</p>',
      ].join('\n');
      expect(covered(text)).toEqual([false]);
    });

    it('covers a sibling inside the same parent, not the parent', () => {
      const text = [
        '<section>',
        '  <p>{{ before.key | transloco }}</p>',
        '  <!-- i18n-keys: core.checkout.* -->',
        '  <p>{{ after.key | transloco }}</p>',
        '</section>',
        '<p>{{ outside.key | transloco }}</p>',
      ].join('\n');
      expect(covered(text)).toEqual([false, true, false]);
    });

    it('covers nothing when the comment is the last child', () => {
      const scan = scanOf('<div><p>x</p><!-- i18n-ignore: trailing --></div>');
      expect(scan.markers[0]).toEqual(
        expect.objectContaining({
          kind: 'ignore',
          reason: 'trailing',
          covers: null,
        }),
      );
    });

    it('covers a text node for i18n-ignore and maps offsets into the file', () => {
      const text = '<!-- i18n-ignore: sample -->\n<code>\n  a.b.c\n</code>';
      const scan = scanOf(text, 'c.ts', 5, 100);
      const sample = scan.strings.find((s) => s.value === 'a.b.c');
      const covers = scan.markers[0].covers;
      expect(sample).toEqual(expect.objectContaining({ line: 7 }));
      expect(covers?.start).toBe(100 + text.indexOf('<code>'));
      expect(sample?.offset).toBeGreaterThan(covers?.start ?? Infinity);
      expect(sample?.offset).toBeLessThan(covers?.end ?? -Infinity);
    });
  });
});
