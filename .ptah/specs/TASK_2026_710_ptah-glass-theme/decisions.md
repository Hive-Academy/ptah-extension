# UI correction decisions — 2026-10-22

These decisions cover the new, user-authorized manual-test UI repairs. They do not approve inherited CI corrections or reset their exhausted revision budget.

| Decision | Options considered | Evidence | Decided by | Review/status | Reversible |
| --- | --- | --- | --- | --- | --- |
| Preserve ordinary background utilities and restrict shell transparency | Blanket transparency, per-modal exceptions, explicit shell/role selectors | Previous sessions template:22,30 uses bg-surface-0/1 without an overlay role; old styles.css blanket selector cleared both | Grok repair lane | Parent source review confirms the direct matching defect. Rendered acceptance pending | Yes |
| Add the existing chat inset to glass assistant cards | New spacing values, existing sidebar spacing tokens | message-bubble.component.html:71-75,95 has content-role cards without padding; styles.css chat-bubble uses existing tokens | Grok repair lane | Source-supported. Existing pt-4 separation is overridden. Check disclosure-to-card spacing in Electron | Yes |
| Investigate and correct shared popup containment at the component | More ancestor z-index exceptions, native top-layer wrapper | native-popover.component.ts:89-110 keeps fixed backdrop/panel inside isolated ancestors | Parent | Narrow implementation delegated. Preserve every input/output and lifecycle guard. Independent source review required | Yes |
| Design selector before production implementation | Keep old list, requested tabbed tiles | User requested Light/Dark/Glass tabs, preview tiles, names, existing options | User scope; Grok design lane | Proposal pending independent review. All 36 themes and accent controls must remain | Yes |
| No local execution in this correction phase | Start checks now, preserve temporary restriction | HANDOFF.md temporary no-local-check policy; current user request authorizes source repair, not a new serve/check run | Parent | No tests, diagnostics, lint, build, serve, E2E, or screenshots authorized by this decision | N/A |

## Preservation and ownership

- Work only in the existing ptah-glass-theme worktree.
- Keep all inherited changes, including the unrelated .gitignore change. Do not stage or revert them.
- No new commit, push, merge, PR closure, or worktree removal is authorized here.
- At final handoff, the provider-accounts peer released the heavy-check slot. No heavy operation is active here. Coordinate again before any authorized check.
- The parent session reviews Grok work independently. No Agent/Task subagent is started under the temporary user policy.
