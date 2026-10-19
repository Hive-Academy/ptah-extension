# Batch 2 fix round report

## Changes

- `cache-countdown-clock.service.ts`: sample the current time only when the first subscriber acquires the shared clock. A later tile mount no longer writes the shared signal during construction. Sampling still happens on first mount, when the document becomes visible, and on each running interval tick.
- `inspector-cache-tile.component.ts`: give the labelled tile `role="group"`, so its estimate and early eviction note have an accessible group name. The tile is not a live region.
- `cache-countdown-clock.service.spec.ts`: verify a second acquisition leaves the existing tick unchanged, the interval advances it, and a new first subscriber receives an immediate sample.
- `inspector-cache-tile.component.spec.ts`: verify the group role, accessible estimate/eviction label, and absence of `aria-live`.

## Verification

- Focused Jest (two specs): 2 suites, 5 tests passed.
- `nx typecheck @ptah-extension/chat-ui --parallel=1`: passed.
- `nx lint @ptah-extension/chat-ui --parallel=1`: passed with 0 errors and 7 warnings.
- Scoped Ptah diagnostics: 0 errors in changed files. It also reported 10 errors in unrelated sibling/dependency files; those are outside this fix's scope and did not fail the project typecheck.

## Decisions

- Sample on the first subscriber rather than scheduling a microtask. With zero subscribers, there is no mounted cache tile to dirty; this preserves a synchronous first-mount sample and avoids signal writes when another tile is already mounted. Reversible.
- Use a labelled `group` role rather than a visually hidden duplicate sentence. The existing computed label already contains the estimate and early eviction explanation. Reversible.

## Not done

- The unrelated scoped diagnostic errors and existing lint warnings were not changed; they are outside the assigned file scope.
