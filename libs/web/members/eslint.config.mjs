import nx from '@nx/eslint-plugin';
import baseConfig, {
  MESSAGE_LITERAL_SELECTORS,
} from '../../../eslint.config.mjs';
import angularConfig from '../../../eslint.angular.config.mjs';

/**
 * Lint posture for `@ptah-web/members` (TASK_2026_177 Task 4.7 — NFR-U1,
 * NFR-U2, RK-7).
 *
 * The first four spreads are the SAME posture every `libs/web/*` domain lints
 * under (see `libs/web/account/eslint.config.mjs`), so a file moving into this
 * lib does not change how it is linted. Everything below them is member-panel
 * specific and deliberately stricter.
 *
 * ⚠️ SCOPED TO THIS LIB ON PURPOSE. These rules are not workspace-wide: the
 * webview, the marketing surfaces and `operator`-themed code legitimately use
 * raw hexes and the `ink-*` ramp. The member panel is the one surface whose
 * token vocabulary `docs/design-system/panel-theme-spec.md` fixes, so the rules
 * that keep it fixed live where that vocabulary applies.
 */

/**
 * Token vocabulary the member panel may NOT use, and what to use instead.
 *
 * RK-7 (design drift) is the reason this list exists. The eight approved Stitch
 * screens each emitted their OWN Material-3 token block, differing file to file
 * (`surface-container-low` here, `surface-container-lowest` there,
 * `on-surface-variant` in five of them). `panel-theme-spec.md` collapsed that
 * drift into one system exactly once. Nothing but a rule keeps it collapsed as
 * phases 2-5 add eleven more screens, because the drift arrives one plausible
 * class name at a time, not as an obvious regression.
 *
 * Patterns are `String.raw` so the backslashes reach `esquery`'s regex parser
 * intact. Case is covered by explicit character classes rather than an `/i`
 * flag — esquery's attribute-regex grammar takes no flags.
 */
const BANNED_DESIGN_TOKENS = [
  {
    id: 'raw-hex',
    // #rgb / #rgba / #rrggbb / #rrggbbaa. Ordered longest-first so a 6-digit
    // hex is not matched as a 3-digit one with trailing garbage, and anchored
    // with \b so DOM ids and fragment hrefs (`#account-identity`) do not match.
    pattern: String.raw`#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b`,
    message:
      'Raw hex colour in the member panel (NFR-U2). Every colour comes from a theme token: base-100/200/300, surface-high, hairline, primary, accent, base-content. A hardcoded hex does not follow operator-member -> operator-member-light, so it survives the theme toggle and breaks light mode. See docs/design-system/panel-theme-spec.md §1-§3.',
  },
  {
    id: 'ink-ramp',
    // \b will not fire inside `shrink-0` or `link-` — the preceding character
    // there is a word character, so there is no boundary before `ink`.
    pattern: String.raw`\bink-(?:[0-9]{2,3}|content)\b`,
    message:
      'The ink-* ramp belongs to the `operator` marketing theme and is tied to that theme\'s own untouched ladder — it is NOT derived against the member ladder (panel-theme-spec.md §2 rejects ink-700 as a hairline candidate for exactly this reason). Use base-100/base-200/base-300/surface-high instead.',
  },
  {
    id: 'amber-ramp',
    pattern: String.raw`\bamber-[0-9]{2,3}\b`,
    message:
      'Use the semantic brand tokens, not the raw Tailwind amber ramp: `primary` (#f5a524), `primary-focus` (#c97e0e) and `accent` (#ffbb4d) are the three approved ambers (panel-theme-spec.md §3). amber-* bypasses the theme and cannot be restyled per theme.',
  },
  {
    id: 'material-3',
    pattern: String.raw`\b(?:surface-container(?:-(?:lowest|low|highest|high))?|surface-variant|on-(?:surface|background|primary|secondary|tertiary|error)(?:-(?:variant|fixed|fixed-variant))?|outline-variant|(?:primary|secondary|tertiary|error)-container|inverse-(?:surface|primary|on-surface))\b`,
    message:
      'Material-3 token name. These are Stitch export vocabulary, not tokens this workspace defines — they compile to nothing and render as no colour at all. panel-theme-spec.md maps every one of them onto the daisyUI system: surface-container-low -> base-200, surface-container -> base-300, surface-container-high(est) -> surface-high, on-surface -> base-content, on-surface-variant -> text-base-content/60, outline-variant -> border-hairline.',
  },
  {
    id: 'border-base-300',
    pattern: String.raw`\bborder-base-300\b`,
    message:
      'base-300 is a FILL, never a border (panel-theme-spec.md §2). At 1.036:1 against a base-200 card it is invisible, and conflating the two means any elevation-ladder tweak silently erases every border. `stat-tile.html` shipped this exact bug. Every boundary in the member panel is `border-hairline`.',
  },
];

/**
 * `.ts` carries the member panel's INLINE templates, so the class strings live
 * in `TemplateElement` (the literal chunks of a template literal) rather than
 * in `Literal`. Both are checked: `Literal` catches a token written in
 * component code — a `[class.x]` map, a chart colour, a constant.
 */
const bannedTokenTsSelectors = BANNED_DESIGN_TOKENS.flatMap(
  ({ pattern, message }) => [
    { selector: `Literal[value=/${pattern}/]`, message },
    { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
  ],
);

/**
 * The same vocabulary in EXTERNAL templates (`member-layout.html`). Without
 * this block the rule would be trivially bypassable by moving a template into
 * its own file, which is the direction this lib is already growing.
 *
 * These are `@angular-eslint/template-parser` node types, not ESTree ones:
 * `TextAttribute` is a static `class="..."`, `Text` is body text, and
 * `LiteralPrimitive` is a string inside a binding such as
 * `[class]="'border-base-300'"`.
 */
const bannedTokenTemplateSelectors = BANNED_DESIGN_TOKENS.flatMap(
  ({ pattern, message }) => [
    { selector: `TextAttribute[value=/${pattern}/]`, message },
    { selector: `Text[value=/${pattern}/]`, message },
    { selector: `LiteralPrimitive[value=/${pattern}/]`, message },
  ],
);

export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...angularConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: ['app', 'ptah'], style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ['app', 'ptah'], style: 'kebab-case' },
      ],

      /**
       * NFR-U1. `eslint.angular.config.mjs` turns this OFF workspace-wide
       * because the marketing surfaces predate it. The member panel is
       * signal-driven and zoneless-ready from its first commit, so every
       * component here is OnPush and this rule is what keeps the twelfth one
       * from being the exception.
       */
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',

      /**
       * NFR-U2. MESSAGE_LITERAL_SELECTORS is re-stated because flat config
       * REPLACES a rule's options rather than merging them — omitting it here
       * would silently switch the workspace-wide message-constant restrictions
       * off for this lib.
       */
      'no-restricted-syntax': [
        'error',
        ...MESSAGE_LITERAL_SELECTORS,
        ...bannedTokenTsSelectors,
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      'no-restricted-syntax': ['error', ...bannedTokenTemplateSelectors],
    },
  },
];
