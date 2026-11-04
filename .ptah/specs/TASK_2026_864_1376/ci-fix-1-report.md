# CI fix round 1

## Files changed

- `libs/frontend/onboarding/src/lib/ready/connection-choice.component.ts:87` — type the injected `ElementRef`.
- `libs/frontend/core/src/lib/services/codex-login.ts:30-34` — explain the intentionally dropped invalid URL.
- `libs/frontend/onboarding/src/lib/ready/provider-readiness.store.ts:76-80,122-125` — document the two intentional failure paths.
- `.ptah/specs/TASK_2026_864_1376/ci-fix-1-report.md:1` — this report.

## A

Changed the host injection to `inject<ElementRef<HTMLElement>>(ElementRef)`, restoring the typed `HTMLElement` receiver for both `querySelector<HTMLInputElement>` calls. Searched `connection-choice.store.ts`, `provider-panel.component.ts`, `ready-connection-step.page.ts`, and `codex-sign-in.service.ts`; none contains the same `inject(X<T>)` pattern, so they were not edited.

## B

- `codex-login.ts:31`: `optional-capability` suppression for an invalid URL that the caller drops.
- `provider-readiness.store.ts:77`: `reported` suppression for a failed selection retry that remains `not-confirmed`; `connection-choice.store.ts:68-69` also uses the boolean result to set its notice.
- `provider-readiness.store.ts:123`: `reported` suppression for the per-provider cycle catch. Its `finally()` clears `retrying`.

Requested audit command: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | grep -E "frontend/(core|onboarding)|TOTAL"`.

Output:

```text
degradation-audit: TOTAL 223 unsuppressed site(s)
```

There are no `frontend/core` or `frontend/onboarding` violation lines. The script lists per-directory `ok` rows only for directories with a violation or baseline entry; these two have neither, so it emitted no rows for them. The total includes existing unsuppressed sites elsewhere.

## Claim check for B3

- `providers.redetectClis()` (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:836-850`) uses `readSection`, which records ordinary request failures in `cliDetection` error state (`providers-settings-sections.ts:95-103`). The Claude derivation turns that state into an error (`provider-readiness.derive.ts:62-64`), shown by the provider panel.
- `ambient.read()` (`claude-ambient-status.service.ts:75-90`) catches transport failures in `fetch()` and publishes a failed view. The provider panel shows that error.
- `codexService.read()` (`codex-readiness.service.ts:44-55`) likewise catches transport failures in `fetch()` and publishes a failed view, shown by the panel.

Narrow caveat: `readSection` calls `workspace.scopeKey()` before its `try` at `libs/frontend/core/src/lib/services/providers-settings-sections.ts:92`. An unexpected exception there could make `redetectClis()` reject without recording a visible error state. No ordinary RPC failure takes that path; the service was left unchanged as requested.

## Decisions

- Used the repository's `plugins/ptah-angular/skills/angular-frontend-patterns/SKILL.md`; the Ptah skill catalog returned no matching local entry, so the repository file was the fallback.
- Kept the existing branch and worktree; no git command was run. No Nx, verify, Jest, TSC, build, serve, e2e, or package target was run, per task instructions. The requested audit was the only executable check.
