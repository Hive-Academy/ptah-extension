# Future enhancements - TASK_2026_578_3b00

This file collects every deferred item from batches.md: the `### Batch N carries` sections, the review follow-ups,
the plan-validation risks, `visual-review.md` and `lane-review-batches-9-12-14.md`.

- `SS` means `libs/backend/skill-synthesis/src/lib`.
- Line numbers are as of commit eb7693b19.
- None of these items blocks the PR. They are ordered by priority within each section.

## P1 — behaviour worth fixing soon

1. **The boot reconcile can remove promoted skills' directories** (Batch 9 M-2). This is also in the Mode 3 handoff,
   for the user to see. `SkillCuratorService.reconcileAcceptedSuggestions` applies the full member merge to
   suggestions accepted before 578: promoted members are rejected `merged-into:` and their directories are removed
   after commit. Before 578, accept only ever merged candidate members. The behaviour follows plan A1/9.3. Options:
   - restrict the reconcile merge to `candidate` members;
   - or log every removed slug once, at warn level.
2. **Retirement can retire a skill used moments ago** (Batch 7 follow-up 1). `stillRetirable` does not re-check
   `lastUsedAt`, so an invocation between the pass snapshot and `rmSync` still retires the skill. Fix: re-read
   last use inside the retire transaction.
3. **A judge panel without a positive control** (Batch 13 MODERATE 2). Reachability proof 4
   (`SS/skill-lifecycle.reachability.integration.spec.ts:609-648`) never shows a candidate at or above the floor
   surviving, so an always-reject regression would pass. Add a surviving candidate.
4. **A pass waits on the reconcile with no timeout** (Batch 9 M-4). `runPass` awaits the in-flight reconcile
   (`SS/skill-curator.service.ts:271`). The reconcile's repropagation is not user-initiated, so a manual run can wait
   behind it. Add a bound, or pass `userInitiated` through.
5. **Over-cap race in promotion** (Batch 6 M-2). `selectWeakestResident` runs before the transaction, so two
   concurrent promotions can both pass the resident cap.

## P2 — robustness and observability

6. **Unproven legacy rows warn on every start** (Batch 9 M-3). Accepted suggestions whose SKILL.md body was edited
   after acceptance never match the exact-body proof (`SS/lifecycle/adoptable-slug.ts`). Rows blocked by a
   non-promoted candidate behave the same way. Options: warn once per row, or use a relaxed proof such as the
   frontmatter name plus a registry candidate id.
7. **Reconcile failures are only in the log** (lane review Batch 9 MINOR, `SS/skill-curator.service.ts:506-515`).
   Surface the `ReconcileResult` counts in diagnostics.
8. **`SkillBacklogPurgeStateStore.read()` cannot tell absent from unreadable** (Batch 8 follow-up). Make `read()`
   tri-state. Its warn text also says "purge will skip", but the effect is a rollback.
9. **An umbrella cluster skipped for lack of a judge anchor has already spent its `skill.analyze` token** (Batch 8).
10. **`registry.remove('skill', row.name)` is not case-normalized** (Batch 7 follow-up 2,
    `SS/lifecycle/skill-retirement.service.ts:252`), unlike the exemption lookup.
11. **`skippedExempt` is only logged** (Batch 9 MINOR). Return it in `AcceptSuggestionResult` / the reconcile counts.
12. **A second `start()` leaks the first interval** (Batch 9 MINOR; predates 578). Clear the handle in `start()`.
13. **`refresh()` has no last-request-wins guard** (Batch 14 R2 M2,
    `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts:139`). An older in-flight
    snapshot can overwrite newer counts. This predates 578; accept adds one more caller.
14. **A stats-only failure after a successful accept shows the accept error string** (Batch 14 R1 MINOR 2,
    `skill-synthesis-state.service.ts` `accept`). Use a separate signal, or at least a comment.
15. **`showToast` timer not cleared on destroy** (lane review Batch 14 MINOR, `skill-suggestions-view.component.ts:567`).

## P3 — tests

16. **The reachability proofs depend on running in order** (Batch 13 MODERATE 1). Proof 3 needs proof 2's
    `umbrellaId`, and proof 4 needs the stage handlers that proof 1 registers. Running with `-t` or `--randomize`
    breaks them. Move the shared setup into `beforeAll`, or document the order.
17. **Proof 2 synchronizes on a log string** (Batch 13 MODERATE 3, spec `:222-225`, `:500`). If
    `'[skill-curator] report written'` is renamed, the failure appears as a misleading timeout.
18. Batch 13 MINOR items:
    - the `settle` return value is unchecked (`:477`);
    - `describe.skip` on a missing sqlite factory (`:97-98`) silently skips all four proofs;
    - `beforeAll` costs about 112 s, so check its timeout under CI load.
19. **No dedicated rollback spec for the `linkedOnly` adopt branch** (Batch 9 re-review MINOR). The `M-1` spec also
    makes every `listByStatus` call throw, not just the first.
20. **Known load flakes**, which pass alone:
    - `SS/cleanup/skill-backlog-cleanup.integration.spec.ts` and `SS/spec-harvester.service.spec.ts` time out at
      5000 ms in full-project runs;
    - rpc-handlers `skills-sh-legacy-adoption.spec` also times out.
21. **Environmental failure**: `libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.spec.ts:113`
    fails whenever a `%TEMP%\.ptah\harness\state.json` exists, because `resolveHarnessWorkspaceRoot` walks up from
    the `tmpdir()` workspace. Isolate the spec's root, for example with a sentinel or an injected root, so an
    ancestor `.ptah` cannot leak in.

## P4 — structure and naming

22. **Extract the resident-promotion tail** (Batch 6 follow-up). `SS/skill-promotion.service.ts` is 1126 lines.
    Move `commitResidentPromotion`, `linkRegistryRow`, `selectWeakestResident` and `afterResidencyChange` into a
    `ResidentPromotionWriter` under `SS/lifecycle/`, keeping `SkillPromotionService` as the facade.
23. **Curator dependencies** (Batch 9 decision 4). There are 10 constructor deps. If an 11th arrives, extract the
    reconcile (`reconcileAcceptedSuggestions`, `reconcileOne`, `commitReconcile`) into a `lifecycle/` collaborator.
24. **Rename `CLUSTER_MEMBER_MAX_CHARS` to `UMBRELLA_MEMBER_MAX_CHARS`** (Batch 12 M1, and the lane review:
    `SS/skill-synthesizer.service.ts:89`).
25. **Tighten the gap-curator source scan** (Batch 12 M2). It now pins `'.insert('`. Name
    `SkillSuggestionStore.insert` in the doc comments (`SS/digest/skill-gap-curator.service.ts:17,760`).
26. **Barrel types without an external consumer** (Batch 12 M3): `UmbrellaMemberInput`, `PoolExclusions`,
    `PoolMember`, `PoolPartition`, `CuratorPassStats`. This matches the barrel's existing pattern; revisit only if
    the barrel is trimmed.
27. **N+1 in `listActiveOrderedByDecayScore`** (R-l, Batch 3 MODERATE-2, `SS/skill-candidate.store.ts`). Use one
    grouped query if the resident cap grows past a few hundred. That query costs against the store's max-lines
    budget (1272 lines).
28. Batch 14 small items:
    - collapse the five count cells in `skill-pipeline-status.component.ts` into an `@for` (R1 MINOR 3);
    - drop the batch/commit citation from the comment at `skill-diagnostics-state.service.spec.ts:39` and state only
      the invariant (R2 M1);
    - add a comment explaining why accept makes both `loadStats` and the diagnostics `refresh` (R2 M4).

## P5 — visual (Batch 14 visual review, all optional)

29. At 320-400 px the six counters wrap with a ragged last line. A `grid grid-cols-2 sm:flex` or `gap-x-4` layout
    would even it out.
30. The "Candidates by status" label is a flex item and duplicates the group's `aria-label` (predates 578).
31. The muted label in the light theme has 4.80:1 contrast, close to the 4.5:1 floor (token `--bcm`, predates 578).
