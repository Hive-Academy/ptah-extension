## Frontend implementation — `TASK_2026_677_efcd`, batch B-1

**Verdict**: COMPLETE. The batch spec and the 5 style specs pass, and so do typecheck and lint. Of the 18 suites in the full `nx test` run, 6 cannot load in this worktree. The cause is the environment (the worktree has no `node_modules`), not B-1. See Verification.

**Tasks completed**: B-1.1, add per-theme status-ink tokens and tailwind utilities.

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\clean-session-view\apps\ptah-extension-webview\src\styles.css
  - `--ptah-link` base definition placed after the brand-gold block: `:root` = `var(--ptah-gold)`, `[data-theme-mode='light']` = `var(--ptah-gold-strong)` (design-spec 1.6).
  - The 32 generated `[data-theme='x'] { --state-ink-run/need/err/done; --ptah-accent-ink }` blocks, copied verbatim from design-spec 8.2 (lines 913-944). They sit after the `--bcm` blocks, under a header comment.
  - Stock-theme scope `[data-theme]:not([data-theme^='anubis']) { --ptah-link: var(--ptah-accent-ink); --ptah-check-edge: 70%; }`.
  - Focus-ring override `outline-color: var(--ptah-accent-ink)`. It uses the same two selector shapes as the anubis-light rule, with `:where([data-theme]:not([data-theme^='anubis']))` on the first, and sits right after that rule.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\clean-session-view\apps\ptah-extension-webview\tailwind.config.js
  - Added `'--ptah-check-edge': '55%'` to the `anubis` and `anubis-light` theme objects. The anubis inks are unchanged.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\clean-session-view\apps\ptah-extension-webview\src\app\state-ink-contrast.spec.ts
  - Kept the anubis tests as they were, and added an anubis `--ptah-check-edge === '55%'` test.
  - New `stock theme status inks in styles.css` describe:
    - It reads the theme names from `DAISYUI_THEMES` (`@ptah-extension/core`), as `base-content-muted.spec.ts` does, and asserts there are exactly 32 non-anubis names.
    - Per theme, every `[data-theme='name']` block is merged, and the test asserts that all four `--state-ink-*` and `--ptah-accent-ink` are present as 6-digit hex.
    - It asserts that the stock scope sets `--ptah-link: var(--ptah-accent-ink)` and `--ptah-check-edge: 70%`.
    - This is a presence guard only, per plan Decision B-9.

**Evidence per acceptance item**:

- Tokens exist for both theme groups. The anubis inks were already in `tailwind.config.js:111-115, 185-189`. The 32 stock themes get generated blocks in `styles.css`. Each block holds one value per theme, because each stock theme is dark or light, not both.
- Tailwind exposes them. The existing `state-run|need|err|done|idle` colour entries (`tailwind.config.js:32-36`) read `--state-ink-*`. `bg-state-need` and `text-state-*` therefore resolve to the new per-theme inks with no config change, and the names match B §1 exactly. No new Tailwind colour entry was needed or asked for.
- Contrast spec passes: 76/76. The original spec had 40 tests. The new count is 40 + 2 check-edge + 1 count + 32 per-theme + 1 scope = 76, which shows every new guard ran.

**Stack observed**:

- Plain global CSS in `styles.css` with daisyUI v4 themes, set up in `tailwind.config.js`. Theme mode comes from `data-theme-mode`, written by `ThemeService` (`libs/frontend/core/src/lib/services/theme.service.ts:188-192`) on `<html>`.
- CSS is outside lint-staged's globs (`.lintstagedrc.mjs` covers ts/js/json/md only), so the one-line generated blocks stay as pasted.

**Design fidelity**:

- Followed design-spec 8.2 (generated block, token table, scope), design-spec 1.6 (`--ptah-link`) and plan B §1.
- One deviation in selector form: the stock scope for custom properties is not wrapped in `:where()`. See Decisions.

**States covered**: no component states (token-only batch). Accessibility effects:

- Status words now resolve to the measured inks in the 32 stock themes.
- Links in stock themes use `--ptah-accent-ink`.
- The focus ring in stock themes uses `--ptah-accent-ink` instead of `--s`.
- An explicit `focus-visible:outline-*` utility still wins, because the first selector keeps the global rule's 0,1,1 specificity and sits later in the sheet.

**Verification** (from the worktree root, all through `node .ptah/tmp/check-run.mjs`):

- `b1-test`: `npx nx test ptah-extension-webview --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` exited 1.
  - Result: `Test Suites: 6 failed, 12 passed, 18 total` / `Tests: 399 passed, 399 total`.
  - All 6 failures are `Configuration error: Could not locate module marked mapped as: ...\clean-session-view\node_modules\marked\lib\marked.umd.js`. The suites are `app.spec.ts`, `webview-routing.spec.ts`, `unit5-message-routing.spec.ts`, `thoth-message-routing.spec.ts`, `file-link-wiring.spec.ts` and `git-dock-arming-identity.spec.ts`, all of which import `ngx-markdown`.
  - Cause: the worktree has no `node_modules` directory (`ls` confirms). `jest.preset.js:31-33` resolves the `^marked$` mapper against the worktree root, while other modules resolve from `D:\projects\ptah-extension\node_modules`.
  - These are environment failures: no test assertion failed, and B-1 touches no TS that these suites import. Fixing it needs `node_modules` in the worktree (no `npm install` is allowed), or a mapper that points at the main checkout. Both are outside B-1's ownership. Escalated to the team-leader here, not fixed.
- `b1-specs`: `npx jest -c apps/ptah-extension-webview/jest.config.ts` on `state-ink-contrast`, `base-content-muted`, `status-badge-contrast`, `elevation-tokens`, `settings-shared-styles` and `theme-boot-lists` (all 6 specs that parse `styles.css` or the theme config) with `--coverage=false --maxWorkers=2` exited 0. Result: `Test Suites: 6 passed, 6 total` / `Tests: 356 passed, 356 total`.
- `b1-ink`: `state-ink-contrast.spec.ts --verbose` exited 0. Result: `Tests: 76 passed, 76 total`.
- `b1-typecheck`: `npx nx typecheck ptah-extension-webview --parallel=1 --skip-nx-cache` exited 0 (`Successfully ran target typecheck`). It runs `tsc` on `tsconfig.app.json`, so the spec is type-checked by ts-jest in the runs above.
- `b1-lint`: `npx nx lint ptah-extension-webview --parallel=1 --skip-nx-cache` exited 0 (`Successfully ran target lint`), with no warnings in the log.

**Risks and edge cases from the plan validation**:

- **Shared worktree (HIGH).** I touched only the 3 B-1 files. The webview app is not edited by C-1 or B-2 in W1, and none of the 6 environment failures come from their files.
- **Eager bundle headroom (HIGH, BUILD-1).** About 5.5 kB of raw CSS was added, in line with plan B §1 "Quality". I ran no build (BUILD-1 measures it in W8).
- **Webview suite in B-1 (LOW).** Ran the full target with `--maxWorkers=2`; result above.
- **`bg-state-need` name (validation note).** Unchanged and resolves per theme. The names `--state-ink-run/need/err/done`, `--ptah-accent-ink`, `--ptah-link` and `--ptah-check-edge` match B §1 and design-spec 8.2 exactly.
- **A future theme with no block.** It falls back to daisyUI through the existing `var(--state-ink-*, oklch(var(--in)))` entries. The guard fails, because the theme count changes and the theme has no block.
- **Existing parsers of `styles.css` stay green.** The new blocks start with `--state-ink-run`, so `base-content-muted.spec.ts`'s `--bcm` regex skips them. The new `[data-theme-mode='light']` block does not shadow `status-badge-contrast.spec.ts`'s `--ptah-gold-strong:` lookup, because the first matching block wins.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Added the anubis `--ptah-link` base (`:root` gold, `[data-theme-mode='light']` gold-strong) | leave it undefined (plan B §1 lists only the stock override) | design-spec 1.6 says to "Define in `styles.css`" with these exact rules. B §1 overrides `--ptah-link`, which presumes a base. Without it, B-4 / A2 `--ptah-link` consumers get no colour in the two anubis themes | yes |
| Stock custom-property scope written as `[data-theme]:not([data-theme^='anubis'])` (0,2,0), not `:where(...)` | `:where(...)` exactly as B §1 words it | `--ptah-link` is also declared by `:root` and `[data-theme-mode='light']` (0,1,0) on the same `<html>`. A 0,0,0 `:where` rule would lose, so light stock themes would get gold-strong instead of the measured accent ink. The selected themes are the same. The focus-ring rule keeps `:where` as specified | yes |
| One-line generated blocks kept verbatim | reflow to multi-line | B §1 says "verbatim". CSS is outside lint-staged's globs, and `styles.css` already has one-line rules (`.elev-0 { ... }`) | yes |

**Plan deviations**: only the `:where()` specificity point above, where following the plan wording literally would make the token not apply in light stock themes.

**Out-of-scope observations**:

- The worktree has no `node_modules`, so every jest suite that reaches `marked` fails with a configuration error (6 webview suites here). Later batches whose projects import `ngx-markdown` (chat, chat-ui, canvas) will likely hit the same thing. This needs a team-leader decision before W2 verification, for example a `node_modules` junction to the main checkout.
