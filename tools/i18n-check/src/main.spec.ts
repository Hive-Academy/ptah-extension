import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatViolation } from './lib/report';
import { run, type Options } from './main';

// `parseTemplate` throws for a template containing THROW_IN_PARSER, so a
// throwing parse can be exercised; every other template parses for real.
jest.mock('@angular/compiler', () => {
  const actual = jest.requireActual('@angular/compiler');
  return {
    ...actual,
    parseTemplate: (...args: Parameters<typeof actual.parseTemplate>) => {
      if (String(args[0]).includes('THROW_IN_PARSER')) {
        throw new Error('parser exploded');
      }
      return actual.parseTemplate(...args);
    },
  };
});

describe('run', () => {
  let root: string;
  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const options: () => Options = () => ({
    workspaceRoot: root,
    projectRoot: 'libs/web/pricing',
    scope: 'pricing',
    allowScopes: [],
    glossary: 'glossary.json',
  });
  const report = async (): Promise<string[]> =>
    (await run(options())).map(formatViolation);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-run-'));
    write('glossary.json', '[]');
    write(
      'libs/web/pricing/src/lib/i18n/en.json',
      JSON.stringify({ card: { heading: 'Plan', note: 'Note' } }),
    );
    write(
      'libs/web/pricing/src/lib/i18n/ar.json',
      JSON.stringify({ card: { heading: 'الخطة', note: 'ملاحظة' } }),
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a throwing template parse for that file and still checks the others', async () => {
    write('libs/web/pricing/src/lib/a-broken.html', '<p>THROW_IN_PARSER</p>');
    write(
      'libs/web/pricing/src/lib/b-valid.html',
      "<p>{{ 'pricing.card.missing' | transloco }}</p>",
    );
    expect(await report()).toEqual([
      'libs/web/pricing/src/lib/a-broken.html:1: [parse-error] - template parser threw: parser exploded',
      'libs/web/pricing/src/lib/b-valid.html:1: [unknown-key] pricing.card.missing - not a key in libs/web/pricing/src/lib/i18n/en.json',
    ]);
  });

  it('reports a project with no source files instead of passing', async () => {
    expect(await report()).toEqual([
      'libs/web/pricing/src:0: [no-source-files] - no .ts or .html source file found under the project src',
    ]);
  });

  it('reports a key constant declared twice, naming both locations', async () => {
    write(
      'libs/web/pricing/src/lib/a.ts',
      "export const CARD_I18N_KEYS = { h: 'pricing.card.heading' } as const;\n",
    );
    write(
      'libs/web/pricing/src/lib/b.ts',
      "\nexport const CARD_I18N_KEYS = { n: 'pricing.card.note' } as const;\n",
    );
    const where =
      'libs/web/pricing/src/lib/a.ts:1, libs/web/pricing/src/lib/b.ts:2';
    expect(await report()).toEqual([
      `libs/web/pricing/src/lib/a.ts:1: [duplicate-key-constant] CARD_I18N_KEYS - declared more than once in the project: ${where}`,
      `libs/web/pricing/src/lib/b.ts:2: [duplicate-key-constant] CARD_I18N_KEYS - declared more than once in the project: ${where}`,
    ]);
  });

  it('checks a key constant with the target of the call that reads it', async () => {
    write(
      'libs/web/pricing/src/lib/c.ts',
      [
        "export const GROUP_I18N_KEYS = { card: 'pricing.card' } as const;",
        "export const LEAF_I18N_KEYS = { heading: 'pricing.card.heading' } as const;",
        "export const UNREAD_I18N_KEYS = { card: 'pricing.card', h: 'pricing.card.heading' } as const;",
        'const g = translateObjectSignal(GROUP_I18N_KEYS.card);',
        'const l = translateObjectSignal(LEAF_I18N_KEYS.heading);',
        'const t = translate(GROUP_I18N_KEYS.card);',
      ].join('\n'),
    );
    const lines = await report();
    expect(lines).toEqual([
      'libs/web/pricing/src/lib/c.ts:1: [unknown-key] pricing.card - not a key in libs/web/pricing/src/lib/i18n/en.json',
      'libs/web/pricing/src/lib/c.ts:2: [not-a-group] pricing.card.heading - translateObjectSignal needs a non-empty group, but this is a single key in libs/web/pricing/src/lib/i18n/en.json',
    ]);
  });

  it('attaches markers around escape sequences in inline templates and reports file lines', async () => {
    const source = [
      '@Component({',
      '  selector: "x",',
      // Escapes right before the marker and right inside the covered element.
      String.raw`  template: '<p>\u00C9t\u00E9</p><!-- i18n-keys: pricing.card.heading --><b>\u00A0{{ first | transloco }}</b>{{ loose | transloco }}',`,
      '})',
      'class X {}',
      '@Component({',
      // An escaped `\n` (no file line break) and `\\` before the marker.
      String.raw`  template: '<p>a\nb\\</p><!-- i18n-keys: pricing.card.note --><em>{{ second | transloco }}</em><i>{{ third | transloco }}</i>',`,
      '})',
      'class Y {}',
    ].join('\n');
    write('libs/web/pricing/src/lib/escaped.component.ts', source);
    expect((await run(options())).map(formatViolation)).toEqual([
      'libs/web/pricing/src/lib/escaped.component.ts:3: [unannotated-computed-key] loose - cover it with an `i18n-keys:` marker or read it from a `*I18N_KEYS` constant (needs a key)',
      'libs/web/pricing/src/lib/escaped.component.ts:7: [unannotated-computed-key] third - cover it with an `i18n-keys:` marker or read it from a `*I18N_KEYS` constant (needs a key)',
    ]);
  });

  describe('allowed scope with structural violations', () => {
    const CORE_EN = 'libs/web/core/src/lib/i18n/en.json';
    const withCore = (): Options => ({ ...options(), allowScopes: ['core'] });
    beforeEach(() => {
      write(
        'libs/web/pricing/src/lib/p.ts',
        "export const t = translate('core.checkout.error');\n",
      );
    });

    it('adds one line naming the allowed scope file', async () => {
      write(
        CORE_EN,
        [
          '{',
          '  "checkout": {',
          '    "error": "Failed",',
          '    "a.b": "Dotted",',
          '    "error": "Again",',
          '    "empty": ""',
          '  }',
          '}',
        ].join('\n'),
      );
      expect((await run(withCore())).map(formatViolation)).toEqual([
        `${CORE_EN}:0: [allowed-scope-defect] - allowed scope "core" has 3 structural violation(s) (dotted-key, duplicate-key, invalid-value); keys read from it cannot be checked reliably here. Run that project's i18n-check`,
      ]);
    });

    it('points at a top level that is not an object', async () => {
      write(CORE_EN, '["not", "an", "object"]');
      expect((await run(withCore())).map((v) => v.kind)).toEqual([
        'allowed-scope-defect',
      ]);
    });

    it('reports an unreadable file in full, without a second pointer line', async () => {
      write(CORE_EN, '{ "checkout": ');
      expect((await run(withCore())).map((v) => v.kind)).toEqual([
        'parse-error',
      ]);
    });

    it('adds nothing for a clean allowed scope', async () => {
      write(CORE_EN, JSON.stringify({ checkout: { error: 'Failed' } }));
      expect(await run(withCore())).toEqual([]);
    });
  });

  it('checks marker keys with the target of the covered call', async () => {
    write(
      'libs/web/pricing/src/lib/d.ts',
      [
        'class D {',
        '  // i18n-keys: pricing.card.note',
        '  readonly leafOnly = translateObjectSignal(this.key);',
        '  // i18n-keys: pricing.card',
        '  readonly group = translateObjectSignal(this.key);',
        '  // i18n-keys: pricing.card.*',
        '  readonly prefix = translateObjectSignal(this.key);',
        '  // i18n-keys: pricing.card.note',
        '  readonly leaf = translate(this.key);',
        '  readonly bare = translateObjectSignal(this.key);',
        '}',
      ].join('\n'),
    );
    expect(await report()).toEqual([
      'libs/web/pricing/src/lib/d.ts:2: [not-a-group] pricing.card.note - translateObjectSignal needs a non-empty group, but this is a single key in libs/web/pricing/src/lib/i18n/en.json',
      'libs/web/pricing/src/lib/d.ts:10: [unannotated-computed-key] this.key - cover it with an `i18n-keys:` marker or read it from a `*I18N_KEYS` constant (needs a non-empty group)',
    ]);
  });
});
