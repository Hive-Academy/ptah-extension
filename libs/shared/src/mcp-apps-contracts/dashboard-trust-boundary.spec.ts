/**
 * Trust-boundary tests — TASK_2026_493_9f58 deliverable 7.
 *
 * Research report Revision 6, entry 1: a fixed catalog limits component TYPES
 * and does nothing about agent-controlled VALUES or the action channel. It
 * names five controls, and `context.md` requires this task to test each one.
 * One `describe` per control, numbered as the source numbers them.
 *
 * Controls 3 and 5 are partly renderer obligations (TASK_2026_494 owns the
 * page). What is testable HERE is that the contract makes the unsafe thing
 * unexpressible: there is no HTML-bearing field to bind, and no field in which
 * a spec could name a tool or an RPC method. Each assertion below states what
 * it does and does not prove.
 *
 * Every hostile input is built as a plain `Record<string, unknown>` and fed to
 * the validator's `unknown` parameter. That is deliberate: an agent's JSON is
 * untrusted, so casting it to the contract type to satisfy the compiler would
 * be testing the wrong thing — and would need the `any` that control 2 bans.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DASHBOARD_ACTIONS,
  DASHBOARD_TEXT_FORMATS,
  DASHBOARD_URL_SCHEME_ALLOWLIST,
  isAllowedDashboardUrl,
} from './dashboard-catalog';
import {
  DashboardActionSchema,
  DashboardUrlSchema,
} from './dashboard-spec.schemas';
import { validateDashboardSpec } from './dashboard-spec.validator';
import { renderDashboardSpecText } from './dashboard-text-fallback';
import {
  dashboardJsonBytes,
  makeDashboardSpec,
} from '../testing/fixtures/dashboard-spec';

const validate = (spec: unknown) =>
  validateDashboardSpec(spec, dashboardJsonBytes);

/** A valid envelope as loose JSON, so a test can break exactly one rule. */
function specWith(overrides: Record<string, unknown>): unknown {
  return { ...makeDashboardSpec(), ...overrides };
}

const reasonOf = (result: ReturnType<typeof validate>): string =>
  result.ok ? '' : result.reason;

const CONTRACT_FILES = [
  'dashboard-catalog.ts',
  'dashboard-spec.types.ts',
  'dashboard-spec.schemas.ts',
  'dashboard-spec.validator.ts',
  'dashboard-text-fallback.ts',
  'index.ts',
] as const;

/**
 * A contract file's source with comments removed.
 *
 * Comments have to go before the scan, because these files DOCUMENT the
 * patterns they are forbidden to contain ("no `z.any()`, no `.passthrough()`")
 * and a raw-text scan would flag its own explanation. The stripper is naive by
 * design — it would mangle a regex literal containing `//` or a block-comment
 * opener, and no contract file has one. Keep it that way, or replace this with
 * a real parse.
 */
function contractCode(file: string): string {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const ALL_CONTRACT_CODE = CONTRACT_FILES.map(contractCode).join('\n');

describe('control 1 — action allowlist', () => {
  it.each(DASHBOARD_ACTIONS)('accepts the allowlisted action %s', (action) => {
    const needsUrl = action === 'dashboard.open-url';
    const result = DashboardActionSchema.safeParse({
      action,
      label: { text: 'Do it' },
      ...(needsUrl ? { url: 'https://example.com/report' } : {}),
    });

    expect(result.success).toBe(true);
  });

  it.each([
    'shell.exec',
    'dashboard.delete',
    'dashboard.refresh ',
    'DASHBOARD.REFRESH',
    'ptah_harness_install_mcp_server',
    '',
  ])('rejects the unknown action %p', (action) => {
    expect(
      DashboardActionSchema.safeParse({ action, label: { text: 'x' } }).success,
    ).toBe(false);
  });

  it('rejects an unknown action inside an otherwise valid spec — whole spec, not just the node', () => {
    const result = validate(
      specWith({
        components: [
          {
            id: 'tile',
            kind: 'stat',
            value: 1,
            actions: [{ action: 'shell.exec', label: { text: 'Run' } }],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
  });

  it('keeps the allowlist small, unique and namespaced, so a new verb is a deliberate change', () => {
    for (const action of DASHBOARD_ACTIONS) {
      expect(action.startsWith('dashboard.')).toBe(true);
    }
    expect(new Set(DASHBOARD_ACTIONS).size).toBe(DASHBOARD_ACTIONS.length);
  });
});

describe('control 2 — zod validation of every value, no any, no passthrough', () => {
  it('declares no `any` anywhere in the contract source', () => {
    expect(ALL_CONTRACT_CODE).not.toMatch(/:\s*any\b/);
    expect(ALL_CONTRACT_CODE).not.toMatch(/\bas\s+any\b/);
    expect(ALL_CONTRACT_CODE).not.toMatch(/\bz\.any\s*\(/);
  });

  it('uses no passthrough, loose or catchall object in the contract source', () => {
    expect(ALL_CONTRACT_CODE).not.toMatch(/\.passthrough\s*\(/);
    expect(ALL_CONTRACT_CODE).not.toMatch(/\bz\.looseObject\s*\(/);
    expect(ALL_CONTRACT_CODE).not.toMatch(/\.loose\s*\(/);
    expect(ALL_CONTRACT_CODE).not.toMatch(/\.catchall\s*\(/);
  });

  it('declares no `z.unknown()` value — `unknown` appears only as the boundary input type', () => {
    expect(contractCode('dashboard-spec.schemas.ts')).not.toMatch(
      /\bz\.unknown\s*\(/,
    );
    expect(ALL_CONTRACT_CODE).not.toMatch(/\bz\.unknown\s*\(/);
  });

  it('rejects an unknown key rather than dropping it, and names the path', () => {
    const result = validate(
      specWith({
        components: [
          { id: 'tile', kind: 'stat', value: 1, onClick: 'alert(1)' },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('onClick');
  });

  it('rejects an unknown key on the envelope itself', () => {
    const result = validate(specWith({ html: '<b>hi</b>' }));

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('html');
  });

  it('rejects a nested document smuggled into action params', () => {
    const asObject = DashboardActionSchema.safeParse({
      action: 'dashboard.select',
      label: { text: 'Pick' },
      params: { payload: { nested: true } },
    });
    const asArray = DashboardActionSchema.safeParse({
      action: 'dashboard.select',
      label: { text: 'Pick' },
      params: { payload: ['a', 'b'] },
    });

    expect(asObject.success).toBe(false);
    expect(asArray.success).toBe(false);
  });

  it('rejects a wrongly typed value instead of coercing it', () => {
    expect(validate(specWith({ revision: 1.5 })).ok).toBe(false);
    expect(validate(specWith({ revision: '2' })).ok).toBe(false);
    expect(validate(specWith({ revision: 0 })).ok).toBe(false);
    expect(validate(specWith({ generatedAt: '2026-09-22' })).ok).toBe(false);
    expect(validate(specWith({ components: [] })).ok).toBe(false);
    expect(validate(specWith({ title: 'Build health' })).ok).toBe(false);
  });

  it('rejects a non-object input without throwing', () => {
    for (const input of [null, undefined, 'spec', 42, [], true]) {
      expect(validate(input).ok).toBe(false);
    }
  });
});

describe('control 3 — output escaping', () => {
  it('offers no HTML-bearing field for a renderer to bind to innerHTML', () => {
    // Proves the CONTRACT side: there is no field a spec could put markup in
    // and expect it to be parsed. The renderer-side obligation (no innerHTML,
    // text binds as text) belongs to TASK_2026_494 and cannot be tested here.
    expect(ALL_CONTRACT_CODE).not.toMatch(/innerHTML/i);
    expect(ALL_CONTRACT_CODE).not.toMatch(/dangerously/i);
    expect(ALL_CONTRACT_CODE).not.toMatch(/bypassSecurityTrust/i);
    expect(ALL_CONTRACT_CODE).not.toMatch(/\bhtml\s*:/i);
  });

  it('admits exactly ONE text format, plain, and leaves it undefined by default', () => {
    // The guard against re-opening revision 1's finding 1. `'markdown'` was a
    // second URL channel: the markdown chokepoint's sanitizer is a deny-list
    // whose ALLOWED_URI_REGEXP permits `http:` and `data:`, so a markdown
    // image URL reached a consumer without ever passing
    // `DASHBOARD_URL_SCHEME_ALLOWLIST`. If this assertion fails because a
    // format was added, read the comment on `DASHBOARD_TEXT_FORMATS` first.
    expect([...DASHBOARD_TEXT_FORMATS]).toEqual(['plain']);

    const result = validate(specWith({ title: { text: '# not a heading' } }));
    expect(result.ok).toBe(true);
    // Absent, not defaulted to a string: a renderer reading `undefined` as
    // plain is the safe branch, and no upstream default can flip it silently.
    expect(result.ok && result.spec.title.format).toBeUndefined();
  });

  it.each(['markdown', 'html', 'raw', 'md', 'PLAIN'])(
    'rejects the text format %p',
    (format) => {
      expect(validate(specWith({ title: { text: 'x', format } })).ok).toBe(
        false,
      );
    },
  );

  // The exact payloads the reviewer used to prove finding 1. Each one reached a
  // live `<img src="data:…">` / `<img src="http://…">` through the prescribed
  // markdown path while `format: 'markdown'` was accepted.
  const URL_BEARING_TEXT = [
    '![x](data:image/png;base64,AAAA)',
    '![x](http://example.com/x.png)',
    '[link](data:text/html,<script>alert(1)</script>)',
    '[link](http://example.com)',
    '<img src="http://example.com/x.png">',
    '<img src="data:image/png;base64,AAAA">',
    '[ref][1]\n\n[1]: data:image/png;base64,AAAA',
  ] as const;

  it.each(URL_BEARING_TEXT)(
    'gives %p no interpreted channel through a title',
    (text) => {
      // The channel is closed at its root: there is no longer any format value
      // that licenses a consumer to parse this string, so the only reading
      // left is "literal text".
      expect(
        validate(specWith({ title: { text, format: 'markdown' } })).ok,
      ).toBe(false);

      const asPlain = validate(specWith({ title: { text } }));
      expect(asPlain.ok).toBe(true);
      expect(asPlain.ok && asPlain.spec.title.format).toBeUndefined();
    },
  );

  it.each(URL_BEARING_TEXT)(
    'gives %p no interpreted channel through a list item, the other reported route',
    (text) => {
      const asMarkdown = validate(
        specWith({
          components: [
            {
              id: 'failures',
              kind: 'list',
              items: [{ text: { text, format: 'markdown' } }],
            },
          ],
        }),
      );
      expect(asMarkdown.ok).toBe(false);
    },
  );

  it('keeps a data: or http: URL out of every scheme-checked field, so text is the only place it can sit', () => {
    // Belt and braces on the narrowing: the same strings are still refused
    // wherever the contract does declare a URL, so removing markdown did not
    // leave a softer route open.
    for (const url of [
      'data:image/png;base64,AAAA',
      'http://example.com/x.png',
    ]) {
      expect(
        validate(
          specWith({
            components: [
              {
                id: 'failures',
                kind: 'list',
                items: [{ text: { text: 'x' }, url }],
              },
            ],
          }),
        ).ok,
      ).toBe(false);
      expect(
        DashboardActionSchema.safeParse({
          action: 'dashboard.open-url',
          label: { text: 'Open' },
          url,
        }).success,
      ).toBe(false);
    }
  });

  it('names no markdown renderer, so nothing directs a consumer to one', () => {
    // `DASHBOARD_MARKDOWN_CHOKEPOINT` used to live in the contract and pointed
    // a renderer at `@ptah-extension/markdown`. It is gone: an export that
    // documents a path the contract no longer permits is worse than no export.
    expect(ALL_CONTRACT_CODE).not.toMatch(/ptah-extension\/markdown/);
    expect(ALL_CONTRACT_CODE).not.toMatch(/CHOKEPOINT/);
  });

  it('emits text verbatim in the plain-text fallback, parsing nothing', () => {
    const result = validate(
      specWith({
        components: [
          {
            id: 'tile',
            kind: 'stat',
            title: { text: '<img src=x onerror=alert(1)>' },
            value: '**bold**',
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(renderDashboardSpecText(result.spec)).toContain(
      '<img src=x onerror=alert(1)>: **bold**',
    );
  });
});

describe('control 4 — URL scheme allowlist', () => {
  it('allows only https:', () => {
    expect([...DASHBOARD_URL_SCHEME_ALLOWLIST]).toEqual(['https:']);
  });

  it.each([
    'https://example.com',
    'https://example.com/path?q=1#frag',
    'HTTPS://EXAMPLE.COM',
  ])('accepts %p', (url) => {
    expect(isAllowedDashboardUrl(url)).toBe(true);
    expect(DashboardUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    '\njavascript:alert(1)',
    '\tjavascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'file://C:/Windows/System32/config/SAM',
    'http://example.com',
    'vscode://ptah/run',
    'ptah://open',
    '//example.com/protocol-relative',
    '/relative/path',
    'example.com',
    '',
  ])('rejects %p', (url) => {
    expect(isAllowedDashboardUrl(url)).toBe(false);
    expect(DashboardUrlSchema.safeParse(url).success).toBe(false);
  });

  it('rejects an https URL carrying embedded credentials', () => {
    expect(isAllowedDashboardUrl('https://user:pass@example.com')).toBe(false);
    expect(isAllowedDashboardUrl('https://user@example.com')).toBe(false);
  });

  it('rejects a javascript: URL inside an otherwise valid spec — whole spec', () => {
    const result = validate(
      specWith({
        components: [
          {
            id: 'link',
            kind: 'list',
            items: [{ text: { text: 'Open' }, url: 'javascript:alert(1)' }],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
  });

  it('applies the same check to an action url', () => {
    expect(
      DashboardActionSchema.safeParse({
        action: 'dashboard.open-url',
        label: { text: 'Open' },
        url: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });
});

describe('control 5 — host mediation of every action', () => {
  it.each([
    'toolName',
    'tool',
    'rpcMethod',
    'method',
    'command',
    'handler',
    'script',
    'eval',
  ])('gives a spec no %s field in which to name an executable', (key) => {
    const result = DashboardActionSchema.safeParse({
      action: 'dashboard.refresh',
      label: { text: 'Refresh' },
      [key]: 'ptah_harness_install_mcp_server',
    });

    expect(result.success).toBe(false);
  });

  it('carries an action as an id plus scalar params, and nothing executable', () => {
    const result = DashboardActionSchema.safeParse({
      action: 'dashboard.select',
      label: { text: 'Pick row' },
      params: { row: 3, key: 'duration', descending: true },
    });

    expect(result.success).toBe(true);
    expect(result.success ? Object.keys(result.data).sort() : []).toEqual([
      'action',
      'label',
      'params',
    ]);
  });

  it('allows a url only on the one action whose meaning is "open a url"', () => {
    expect(
      DashboardActionSchema.safeParse({
        action: 'dashboard.refresh',
        label: { text: 'Refresh' },
        url: 'https://example.com',
      }).success,
    ).toBe(false);

    expect(
      DashboardActionSchema.safeParse({
        action: 'dashboard.open-url',
        label: { text: 'Open' },
      }).success,
    ).toBe(false);
  });

  it('keeps a referenced dataset behind an opaque id the renderer cannot resolve alone', () => {
    // `resultId` is a slug — not a path, a URL or a query — so a spec value
    // cannot become a data fetch. Resolving it is a host action
    // (`dashboard.drill-down`).
    const valid = validate(
      specWith({
        components: [
          {
            id: 'big',
            kind: 'table',
            columns: [{ key: 'name', label: { text: 'Name' } }],
            data: { resultId: 'query-9f58', rowCount: 120_000 },
          },
        ],
      }),
    );
    expect(valid.ok).toBe(true);

    for (const resultId of [
      '../../etc/passwd',
      'https://example.com/data',
      '/tmp/x',
      'a b',
      'SELECT * FROM t',
    ]) {
      const hostile = validate(
        specWith({
          components: [
            {
              id: 'big',
              kind: 'table',
              columns: [{ key: 'name', label: { text: 'Name' } }],
              data: { resultId },
            },
          ],
        }),
      );
      expect(hostile.ok).toBe(false);
    }
  });
});
