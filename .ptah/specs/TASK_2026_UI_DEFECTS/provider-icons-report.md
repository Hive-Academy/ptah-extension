# Provider icons

The existing shared `ptah-provider-mark` is the sole renderer for provider and
CLI identifiers. It uses static path data through `ptah-mark-svg` with
`paint="mono"`; the renderer binds SVG attributes and never parses SVG markup.
All marks are decorative (`aria-hidden`) and their adjacent provider labels keep
the accessible name.

## Icon sources

| Provider / IDs                                  | Source                                                                                                                             | License |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Anthropic / `anthropic`, `claude-cli`           | [theSVG Anthropic and Claude icons](https://github.com/glincker/thesvg/tree/20c10d8dd10bbce6de90101f50599d5686061cfa/public/icons) | CC0-1.0 |
| OpenAI Codex / `codex`                          | [Simple Icons OpenAI](https://github.com/simple-icons/simple-icons/tree/develop/icons)                                             | CC0-1.0 |
| Ollama, Ollama Cloud / `ollama`, `ollama-cloud` | [Simple Icons Ollama](https://github.com/simple-icons/simple-icons/blob/develop/icons/ollama.svg)                                  | CC0-1.0 |
| Google Gemini for Antigravity / `antigravity`   | [Simple Icons Google Gemini](https://github.com/simple-icons/simple-icons/blob/develop/icons/googlegemini.svg)                     | CC0-1.0 |
| GitHub Copilot / `copilot`                      | [Simple Icons GitHub Copilot](https://github.com/simple-icons/simple-icons/blob/develop/icons/githubcopilot.svg)                   | CC0-1.0 |
| Cursor / `cursor`                               | [Simple Icons Cursor](https://github.com/simple-icons/simple-icons/blob/develop/icons/cursor.svg)                                  | CC0-1.0 |
| OpenCode / `opencode`                           | [Simple Icons OpenCode](https://github.com/simple-icons/simple-icons/blob/develop/icons/opencode.svg)                              | CC0-1.0 |
| xAI Grok / `grok`                               | No freely licensed official xAI SVG found; static neutral X mark retained in the safe path table                                   | N/A     |

## Consumers switched

These surfaces already route their displayed provider ID through the shared
component, so extending the shared map switches them without duplicate local
maps or layout changes.

- Analytics provider-account cards: `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:168`
- Chat session plan-limit tiles / CLI rows: `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts:350,414`
- Settings CLI-instance rows and provider assignments: `libs/frontend/chat/src/lib/settings/providers/add-cli-instance-modal.component.ts:85,91`; `provider-consumer-assignments.component.ts:87`
- Provider pickers and setup wizard: `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:185,201`; `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:312,472`

## Files changed

- `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\provider-brand-art.vendored.ts`
- `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\brand-slugs.ts`
- `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\provider-marks.data.ts`
- `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\provider-mark.component.spec.ts`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_UI_DEFECTS\provider-icons-report.md`

## Checks

- `npx jest -c libs/frontend/ui/jest.config.ts libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.spec.ts --coverage=false --maxWorkers=2` — passed (1 suite, 9 tests).
- `npx nx typecheck @ptah-extension/ui --parallel=1` — passed. Nx Cloud reported its unrelated disabled-organization warning after the target completed.

## Decisions

- Reused the existing `ProviderMarkComponent` and its path-only renderer as the single rendering path; no runtime remote loads, `innerHTML`, or new dependency.
- Preserved its unknown-provider fallback behavior (Bot, Server, or Terminal selected by the calling surface).
- Used Google Gemini as the documented free fallback for Antigravity.
- Kept the existing Ollama mark, which already covers both Ollama IDs; the requested provider mappings now ensure the named CLI/provider IDs resolve to real marks.
- xAI does not offer a confirmed freely licensed SVG in the sources reviewed, so Grok receives a neutral X-shaped static path rather than a copied proprietary asset.
