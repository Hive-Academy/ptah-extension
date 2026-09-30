# Handoff: TASK_2026_575_fee7 (landing page English/Arabic i18n)

Written at the end of the first session, 2026-09-27. Read this first. Then read `batches.md`, which is the source of truth for task state.

## Where things stand

- **Branch:** `claude/sleepy-turing-pdzxlm`, pushed.
- **PR:** [Hive-Academy/ptah-extension#603](https://github.com/Hive-Academy/ptah-extension/pull/603), a draft. Its description carries a progress checklist; update it as batches land.
- **Progress:** 13 of 33 batches are committed. The last code commit is `eebe6ed1` (Batch 13, download page) and the last batches.md record is `75a14a18`. `batches.md` carries a "Session paused after Batch 13" note; Batch 14 is PENDING and is next. All document gates are approved by the owner:
  - Gate 0 and Gate 1 (requirements),
  - Gate 1.7 (design and prototype),
  - Gate 2 (implementation plan).
- **Workflow:** the repo's orchestration skill (`.claude/skills/orchestration/SKILL.md`), FEATURE flow, Full depth. No CLI lanes exist in cloud sessions, so every phase runs as a subagent. Document reviews were same-side, with the reason recorded.
- **CI on the PR head:** green. The SonarCloud quality gate passes.

### Done

| Batches | What                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2     | `@ptah-extension/i18n` (`libs/frontend/i18n`): service, resolver, pipes, testing provider, `loadScopeTranslations` helper. Transloco 8.4.0.                                                 |
| 3–6     | `tools/i18n-check`: parity, keys, glossary, RTL and format rules, `review-tables`, `check-prerender`. English prerender baselines in `apps/ptah-landing-page/prerender-baseline/`. CI step. |
| 7–8     | Translation scopes for all 11 projects.                                                                                                                                                     |
| 9       | App wiring: `provideI18n`, route resolvers, pre-paint `lang`/`dir` script, Arabic font loader, `data-app-stable` marker, `prerender-check` target.                                          |
| 10      | Key-based `SeoService` (og/twitter stay English). `core` messages are `I18nMessage`.                                                                                                        |
| 11      | Header language switcher and `ui` strings.                                                                                                                                                  |
| 12      | Panel `LanguageSwitch` and RTL panel shell. The icon-mirroring fix is retrofitted into Batch 11's LogOut icons.                                                                             |
| 13      | Download page and the app `i18n-check` target. See `batches.md` for whether it was committed.                                                                                               |

### Remaining

| Batches | What                                                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14–15   | `landing` sections (animated, GSAP, 3D; see design-spec §3.5 per-section decisions)                                                                                                                                         |
| 16–17   | `legal`, including the Arabic-only "English version governs" notice                                                                                                                                                         |
| 18      | `pricing`                                                                                                                                                                                                                   |
| 19      | `auth`                                                                                                                                                                                                                      |
| 20      | `account`                                                                                                                                                                                                                   |
| 21–24   | `members`                                                                                                                                                                                                                   |
| 25–31   | `admin`                                                                                                                                                                                                                     |
| 32      | Glossary top-up, copy-review regeneration, and extra specs (Task 32.3)                                                                                                                                                      |
| 33      | i18n e2e suite. **Contingent:** if the English stability control fails, activate TASK_2026_576_54d7 (GSAP/Lenis outside the zone) as an extra batch on this same branch/PR. This is the owner's decision; do not ask again. |

After Batch 33:

- team-leader Mode 3;
- Gate 3 (QA choice);
- the owner's Arabic copy sign-off per scope from `copy-review/<scope>.md` (requirement 8.3). This is a merge gate.

## Owner decisions (also in `context.md`)

- **Language switch:** client-side toggle only. No `/ar/` URLs. Choice stored in `localStorage` (`ptah.lang`). Arabic is auto-detected from `navigator.languages[0]`. Prerendered HTML stays English.
- **Scope:** the whole landing app. Agents draft the Arabic and the owner reviews it before merge.
- **Numbers and legal:** Western digits in Arabic (`ar-u-nu-latn`). Legal pages get an Arabic-only "English version governs" notice.
- **Sonar:** `.sonarcloud.properties` excludes `.ptah/**` and `tools/**/__fixtures__/**` (owner chose this option).
- **SEO keys:** `web-core` `i18n-check` allow-list widened to `ui,app,landing,legal,pricing` for SEO keys. The download page has `app.seo.download.{title,description,ogTitle,ogDescription}`.
- **TASK_2026_576:** filed as a separate task, delivered in the same PR if triggered.
- **Admin stat tiles:** now show thousands separators in English ("1,234"). The owner was told and did not object.

## Rules learned this session (all in `batches.md` "Execution defaults" / "Handover notes")

- **Lockfile:** write it with `npx npm@11` (the repo expects Node 24). The container's npm 10 strips `libc` fields.
- **Checks every batch runs:**
  - `nx run degradation-audit:lint`;
  - the typed SonarJS bug-rule check on changed `.ts` files, which must report 0 problems. It lives in the scratchpad `sonar/` folder of the old session; re-create it if missing: `npm i eslint@9 eslint-plugin-sonarjs typescript-eslint typescript@6` in a scratch dir, with an `eslint.typed.mjs` enabling sonarjs `problem`-type rules using `projectService`. Typical traps: `.sort()` with no comparator, and `=== undefined` on an indexed value typed as never-undefined.
- **Prerender baselines:**
  - Never run `check-prerender --update`. The baselines were captured once from unmodified templates; README in that folder.
  - The live countdown is skipped via `data-prerender-volatile`.
  - English copy on prerendered routes must stay byte-identical.
- **Icon mirroring:** wrap the icon in `<span class="inline-flex shrink-0 rtl:scale-x-[-1]" aria-hidden="true">`. Never put `rtl:scale-x-*` on `<lucide-angular>` itself: lucide copies host classes onto its svg, so the flip cancels. Guard: `rg -U '<lucide-angular[^>]*rtl:-?scale-x' libs/web` must return nothing.
- **Nx flags:** do not pass `-- --maxWorkers` through `nx run-many`, because it breaks `typecheck`. Use `--parallel`.
- **Testing recipe:** app and lib specs use `provideI18nTesting` with the owning scope plus `ui`/`core` via `loadScopeTranslations`. Consumer specs of translated components need the provider too.
- **Screenshots:**
  - Chromium path: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Playwright is global (`npm root -g`). Never run `playwright install`.
  - Member/admin shells need `page.route` mocks for `/auth/me`, `/members/entitlement`, `/admin/*`.
  - Public pages are dark-only.
- **Reviews:** logic review for behaviour, plus visual review for UI batches. At most 3 review rounds per batch, then escalate to the owner. Team-leader commits by explicit path. Executors never run git.
- **Team-leader instances:** use a fresh one per batch. It reads the handover notes in `batches.md`.

## Open carry-overs

- **Accessibility follow-up (pre-existing, out of scope; fix only if the owner asks):** on the download page, `text-neutral-content/40` measures about 2.6:1 contrast (`download-page.component.ts:194,200,239,245,286,292,307`), and the "View release notes" link has a 16px hit area (`:303-317`). Both predate this task. The Batch 13 visual review flagged them and the batch was accepted for its i18n/RTL scope.

- **Task 32.1:** glossary candidates collected in batches 10–13 (Paddle, Windows, macOS, Linux, SaaS, PRD, Cron, GitHub, SDK, Builders, Claude Agent SDK, Meet, Discord, Reddit, LinkedIn, VS Code Marketplace, IDE, AppImage, Debian, Ubuntu).
- **Task 32.3:**
  - specs for `PaddleCheckoutService` and `SSEEventsService`;
  - log `arLocale.error()` in `session-calendar.ts`.
- **Batch 25:** unmirrored ChevronRight in admin `needs-attention-queue.html`; admin copy; `Intl...resolvedOptions().timeZone` in `course-detail.ts` needs an `i18n-format-exempt` marker.
- **Batch 15:** prove the server half of A1 (a unique `landing` value appears in the prerendered HTML).
- **Account batch:** `SESSION_TOPICS` / `FEATURE_DISPLAY_MAP` English data in `web-core`.
- **Unassigned:** `github-release.service.ts` `getAssetLabel`/`formatSize` return English asset labels. They are core-scope, not yet keyed.

## How to resume in a new session

Paste this as the first message of the new session:

> Continue TASK_2026_575_fee7 on branch `claude/sleepy-turing-pdzxlm` (draft PR Hive-Academy/ptah-extension#603) using the repo's orchestration skill. Read `.ptah/specs/TASK_2026_575_fee7/handoff.md`, then `batches.md` (Execution defaults, Handover notes, and the first batch not marked COMPLETE). All document gates are approved; continue the batch loop: frontend-developer executor → code-logic-reviewer (plus visual-reviewer for UI batches) → fresh team-leader in Mode 2 to commit. Subscribe to PR #603 activity and keep CI green.

Before starting:

- `git fetch` and check the branch is up to date with its remote.
- Run `npm ci`. `node_modules` is not committed.
