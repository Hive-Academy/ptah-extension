# Batch 5 — Settings glass reading planes

## Changed sections

| Tab | Top-level section wrappers with `data-glass-surface="content"` | Source and spec |
| --- | --- | --- |
| Context Management | Subagent prompt-cache TTL | `libs/frontend/chat/src/lib/settings/ptah-ai/subagent-cache-ttl-setting.component.ts:53`; spec `:139` |
| Context Management | Session budget | `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts:175`; spec `:132` |
| Context Management | Lane guards | `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.component.ts:53`; spec `:74` |
| Context Management | Routing suggestions (Electron) | `libs/frontend/chat/src/lib/settings/ptah-ai/host-routing-setting.component.ts:53`; spec `:109` |
| Context Management | Context budgets, Codex agents, Background queries | `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts:82`; spec `:150` |
| Advanced | Membership & data | `libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts:74`; spec `:139` |
| Advanced | Agent behaviour | `libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:95`; spec `:108` |
| Advanced | Output Style | `libs/frontend/chat/src/lib/settings/output-style/output-style-config.component.ts:59`; spec `:145` |
| Advanced | MCP & Browser | `libs/frontend/chat/src/lib/settings/pro-features/mcp-port-config.component.ts:56`; spec `:109` |
| Advanced | Claude Code tools & skills (existing plane; glass padding aligned) | `libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts:80,318`; spec `:157` |
| Advanced | VS Code Language Model (when available) | `libs/frontend/chat/src/lib/settings/pro-features/vscode-lm-config.component.ts:42`; spec `:134` |
| Advanced | Fine-tuning disclosure, including its three upkeep groups | `libs/frontend/chat/src/lib/settings/advanced-settings.component.ts:171,206-208,221`; spec `:89,202` |
| Search & Voice | Web Search | `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts:114`; spec `:142` |
| Search & Voice | Voice engines (Electron) | `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.ts:92`; spec `:135` |
| Search & Voice | Diagnostics: go vet (Electron) | `libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:82`; spec `:171` |

The changed spec files are:

- Context Management: `libs/frontend/chat/src/lib/settings/ptah-ai/subagent-cache-ttl-setting.component.spec.ts:139`, `session-budget-settings.component.spec.ts:132`, `lane-guards-settings.component.spec.ts:74`, `host-routing-setting.component.spec.ts:109`, `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts:139,150`.
- Advanced: `libs/frontend/chat/src/lib/settings/license/license-status-card.component.spec.ts:139`, `libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.spec.ts:108`, `libs/frontend/chat/src/lib/settings/output-style/output-style-config.component.spec.ts:145`, `libs/frontend/chat/src/lib/settings/pro-features/mcp-port-config.component.spec.ts:109`, `claude-builtins-config.component.spec.ts:157`, `vscode-lm-config.component.spec.ts:134`, `libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts:89,202`.
- Search & Voice: `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.spec.ts:142`, `voice-config.component.spec.ts:135`, `go-vet-consent-config.component.spec.ts:171`.

Each component adds glass-only `1.25rem` padding through `:host-context([data-glass='on'])`, following the Providers content card. The Claude Code tools section already had the content surface; only its glass padding changed. The group component defaults to a plane for Context Management. Fine-tuning passes `contentSurface=false` to its three groups, so its outer `<section>` is the sole content plane. The group spec checks both modes.

## Element and theme checks

The surface sits on actual `<section>` elements, except Membership & data, which uses a normal block `<div>`. These elements have block or flex layout and are not `display: contents` hosts. No content surface was placed on a popover, menu, dropdown, modal, or drawer. The existing tab composition and solid-theme classes remain unchanged; all new padding is gated by `:host-context([data-glass='on'])`. The Providers `providers-main-connections-card` and CLI matrix tile were used as the surface-role reference.

## Verification

`npm run verify -- -p @ptah-extension/chat -- --output-style=static` passed (exit 0). Header showed exactly one project, `@ptah-extension/chat`. Results: 321 test suites passed; 5,720 tests passed, 2 skipped; lint passed with 128 warnings and 0 errors; Angular typecheck passed with existing NG8107 warnings. Scoped `ptah_get_diagnostics` found no new component errors; it reported pre-existing TypeScript errors in unrelated chat specs, including two existing errors in `host-routing-setting.component.spec.ts:303,342`.

No rendered screenshot was available: `ptah_browser_status` reported no active browser session, and this batch prohibits build, serve, dev, and e2e targets. Skill discovery/loading was unavailable in this lane, so `angular-frontend-patterns` could not be loaded; the repository's Angular conventions and the Providers source pattern guided the edit.

## Decisions

- **Section roots vs shell wrappers:** Put planes on child section roots. Shell wrappers would turn the shells' `space-y` children into new block boxes and could alter solid-theme spacing. This is reversible; evidence is the existing shell templates and their inline custom-element children.
- **Fine-tuning surface ownership:** Give the disclosure one outer plane and disable the reused group component's own plane there. This is reversible; the Context Management tab uses the same group component as three separate top-level sections.

## Providers scope addition

| Section | Surface and glass padding | Spec assertion |
| --- | --- | --- |
| CLI Agents & Custom Instances Matrix | `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts:174,178,798` | `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts:321` |
| Ptah CLI instances | `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-instances.component.ts:67,71,404` | `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-instances.component.spec.ts:59` |
| Background Model Roles, including the role cards and Enhancement time limit | `libs/frontend/chat/src/lib/settings/providers/agents-routing-settings.component.ts:102,159` | `libs/frontend/chat/src/lib/settings/providers/agents-routing-settings.component.spec.ts:176` |

Each plane is on a real block `<section>`. The matrix's existing table wrapper remains an inner `tile`, and its instances section is now a sibling of the matrix content section, so content planes do not nest. The background roles plane encloses the disclosure summary, cards, and Enhancement time limit row. No surface is on a `display: contents` host or overlay. The matrix's new outer flex wrapper preserves its original `gap-4` spacing for solid themes; padding is limited to `:host-context([data-glass='on'])` at `1.25rem` in all three components.

### Verification after Providers addition

`npm run verify -- -p @ptah-extension/chat -- --output-style=static` passed (exit 0). Its header named exactly one project, `@ptah-extension/chat`. Results: 321 suites passed; 5,721 tests passed, 2 skipped; lint passed with 128 warnings and 0 errors; Angular typecheck passed with existing NG8107 warnings. Nx reported one cached task out of three. Scoped `ptah_get_diagnostics` reported no errors in the three changed components; a second request for their specs timed out while verification was running. No rendered screenshot was available because `ptah_browser_status` found no active session and build/serve/dev/e2e targets are prohibited.

### Decisions for Providers

- **Separate matrix and instance planes:** The existing matrix root contained the Ptah CLI instances component. Moving that component beside the matrix content section gives each top-level section one content plane and retains the original flex gap. Evidence: `cli-orchestration-matrix.component.ts` template and `ptah-cli-instances.component.ts` labelled section. Reversible.
- **Background roles plane owner:** The outer section in `AgentsRoutingSettingsComponent` contains the closed disclosure and its inner assignments component, including the Enhancement time limit. Putting the plane there covers both summary and content without nested content surfaces. Evidence: the component templates. Reversible.
