# Code Logic Review (fix round 1) — `TASK_2026_681_738f`

Review family: implementer codex, reviewer Claude.

Scope: fix round 1 of `code-logic-review.md`, uncommitted diff in worktree `clean-session-followups`. Whole files read:
`stats-tile-expansion.state.ts` and its spec, the three `sessionKey` callers (`inspector-session-stats.component.ts:203-205`,
`inspector-limits-lanes.component.ts:91-99`, `session-stats-summary.component.ts:277-281`), `message-bubble.component.html:125-152`,
`message-bubble.component.spec.ts:163-260`, `turn-activity-panel.component.ts:107-145,199`. Reports `batch-A2-fix.md` and
`batch-A1-fix.md` read. No nx target, build or test was run by me (orchestrator reported chat + chat-ui typecheck, lint, test PASS).
The "fails on pre-fix code" claim below is inferred from the original review's description of the old code (a signal write
inside `sessionKey`), not executed.

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Assessment      | APPROVED |
| Blocking        | 0        |
| Serious         | 0        |
| Moderate        | 1        |
| Minor           | 4        |

## Item 4 — stats-tile-expansion state (Blocking in round 0)

| Check | Result | Evidence |
| ----- | ------ | -------- |
| No signal write in any render path | OK. `sessionKey` touches only `hosts` (WeakMap), `pendingAliases` (Map) and `nextPendingId`. `isOpen` only reads. The sole `open.update` is inside `setOpen`, reached from `toggle`/`setOpen`/`close` and from event handlers only (`inspector-limits-lanes.component.ts:92,99`, `inspector-session-stats.component.ts:204-205`, `session-stats-summary.component.ts:281`). | `stats-tile-expansion.state.ts:31-53,59-78` |
| Tile opened under null stays open after the ID arrives | OK. `sessionKey` null -> A registers alias `pending:N` under key `A` (`:36-40`); `isOpen('A', t)` checks aliases (`:49-51`). Same expression order (`sessionKey` evaluated as the argument before `isOpen` reads) guarantees the alias exists. | `:36-40,46-53` |
| Toggle on alias-open tile closes it, no reopen | OK. `toggle` -> `isOpen` true -> `setOpen(A,t,false)`: migrates all alias entries to `A::*` (`:64-71`), then deletes `A::t` (`:73`). Alias map entry is removed (`:77`). Set differs, so the signal notifies. Spec covers it (`spec:103-107`). | `:55-78` |
| Real A -> real B does not carry state | OK. Alias is only created when `previous.sessionId === null` (`:36`). | `:36`, spec `:110-118` |
| Two null hosts do not share | OK. Each null host gets a unique `\0pending:N` key (`:35`), cached per host via equality guard (`:33`). | spec `:120-131` |
| Rendered spec would fail pre-fix | Likely yes. The original defect was NG0600 from a signal write during template evaluation; `RenderedStatsHostComponent` (`spec:17-31`) evaluates `sessionKey` inside an OnPush template and asserts `detectChanges` does not throw after the null -> ID change (`spec:95-101`). The old unit specs called state methods directly and could not see it. Not executed by me. | `spec:87-108` |
| Idempotent under dev-mode double check | OK for a single host: repeat `sessionKey` returns the cached key (`:33`) and `isOpen` is pure over unchanged data. | `:33` |

### Reactivity gap (asked for)

`isOpen` reads two sources, the `open` signal and the non-signal `pendingAliases` Map. For the host that adds the alias this
is correct: the alias is written by `sessionKey` in the same binding expression, before `isOpen` reads, and that binding is
already dirty because `sessionId()` (a signal) changed. So the template re-evaluates correctly. The gap is cross-host only,
see Moderate 1. Everything else (open/close) goes through the signal.

## Item 9 — message-bubble `@defer`

| Check | Result | Evidence |
| ----- | ------ | -------- |
| `@defer` with `@placeholder` and `@loading` carrying `panelId()` | OK. Both interim blocks render `<div [id]="panelId()">`, so the button's `aria-controls` target exists from the click until the panel mounts. | `message-bubble.component.html:142-149` |
| No duplicate id once loaded | OK. Angular swaps the placeholder/loading block for the main block, so only one of them is in the DOM at a time. The panel roots carry `[id]="panelId()"` in both branches (`turn-activity-panel.component.ts:112,129`). | same |
| Original assertions kept | OK. The three existing specs keep every `expect`; they gain `await fixture.whenStable(); fixture.detectChanges();` before reading the panel (`spec:189-196,235-240,255-258`). | `spec:169-259` |
| aria-controls target present before load | OK. New spec asserts `[id="<controlledId>"]` exists while `activityPanel()` is null, then that the loaded panel has that id. | `spec:199-220` |
| `TurnActivityPanelComponent` only in `imports` + inside `@defer` | OK. Only references are the import (`message-bubble.component.ts:60`), the `imports` array (`:121`) and the `@defer` body (`html:143`). So Angular still lazy-splits it. | grep result |
| Failure mode of the lazy chunk | Unchanged from round 0: no `@error` block. If the dynamic import fails the user keeps an empty `aria-controls` target, which is not worse than before. | `html:142-149` |

## Moderate

1. Cross-host stale read on alias creation. `stats-tile-expansion.state.ts:36-40,46-53`. Two hosts in one view
   (for example `session-stats-summary` and `inspector-session-stats`, both optional-inject the same view-scoped state) can show the
   same `tileId` for the same session. If host 1 opened tile T while its ID was null, and host 2 is already on session `A`
   and rendered earlier in the CD pass, host 2's binding evaluates `isOpen('A', T)` -> false before host 1 registers its
   alias. Nothing signals host 2, so it stays closed until something else dirties it; in dev mode the `checkNoChanges` pass
   would re-evaluate it to true and raise NG0100. Preconditions are narrow (same tile id on two hosts plus the tile opened
   under null on only one of them), so this does not block. Fix if it ever shows up: bump a version signal from an
   `afterNextRender`/microtask, or key the alias map under a signal.

## Minor

- `stats-tile-expansion.state.ts:27,60-77`: aliases for hosts destroyed while still null (and aliases never followed by a
  `setOpen`) stay until the view is destroyed; round 0's Moderate about pending keys is only partly addressed, and the class
  doc (`:9-22`) still describes no alias/pending behaviour. Bounded by tiles times hosts, so low.
- `stats-tile-expansion.state.ts:36-40`: aliases accumulate per target session (`Set`), so a second host transitioning
  null -> `A` makes its tiles visible to every other host on `A`. Intended sharing, but undocumented.
- `message-bubble.component.spec.ts:216-219`: the "no duplicate id" claim is covered only indirectly. Add
  `expect(fixture.nativeElement.querySelectorAll('[id="' + controlledId + '"]').length).toBe(1)` after load.
- `message-bubble.component.html:142`: `@defer (when activityOpen())` sits inside `@if (activityOpen() && ...)`, so the
  condition is always true at creation and `on immediate` states the intent more plainly. The empty placeholder also means a
  small layout shift when the panel mounts (reported as accepted in `batch-A1-fix.md`).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for item 9, MEDIUM-HIGH for item 4 (reasoned from code and spec reads; the pre-fix failure of the new
  rendered spec was inferred, not executed).
- Top risk: the non-signal alias map can leave a second host stale for one CD cycle (Moderate 1); narrow and not on the
  originally reported path.
