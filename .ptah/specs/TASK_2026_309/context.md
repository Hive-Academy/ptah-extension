# Context

## The rule being protected

A blocked harness path is a desired path that an unowned file occupies. Ptah
refuses to overwrite it because nothing proves Ptah wrote it — see the
harness-sync CLAUDE.md section _"The 13 are of UNKNOWN provenance"_. Three
independent facts establish that the occupants are of unknown origin, and
content matching is explicitly ruled out as an ownership proof.

The consequence for wording is absolute: **every surface that tells a user how
to clear a blocked path must say MOVE, and must never say delete.** Move is
reversible. Delete is not. The occupant may be the user's own irreplaceable
work.

## The five surfaces

| Surface             | Text at                                  | Guard spec                                   |
| ------------------- | ---------------------------------------- | -------------------------------------------- |
| Reconcile WARN      | `harness-reconciler.service.ts:761`      | `harness-reconciler.blocked-logging.spec.ts` |
| Marketplace popover | `harness-blocked-paths.component.ts:93`  | `harness-blocked-paths.spec.ts`              |
| Dashboard card      | `harness-card` component                 | `harness-card.spec.ts`                       |
| Repair dialog       | `harness-repair-dialog.component.ts:181` | `harness-repair-dialog.spec.ts`              |
| Health store        | derived summary text                     | `harness-health.store.spec.ts`               |

## Defect 1 — the guard is a denylist

`harness-reconciler.blocked-logging.spec.ts:273-288`:

```ts
const wholeLine = `${BLOCKED_MESSAGE} ${JSON.stringify(detail)}`;
expect(wholeLine.toLowerCase()).not.toContain('delete');
for (const verb of [/\bdelete[ds]?\b/i, /\bdeleting\b/i, /\bdeletion\b/i, /\bremove[ds]?\b/i, /\bremoving\b/i, /\berase[ds]?\b/i, /\btrash\b/i, /\brm\b/i]) {
  expect(wholeLine).not.toMatch(verb);
}
```

Eight regexes. Every one of these passes:

- purge · wipe · drop · nuke · clear out · get rid of · blow away · scrub
- "send it to the recycle bin"
- "you won't need it after this"

A denylist can only ever ban the phrasings someone thought of. The instruction
it protects is safety-critical, so the failure mode is a user losing work
because the wording drifted into a synonym nobody enumerated.

## Defect 2 — three of the five surfaces never got the synonym list

Only `harness-reconciler.blocked-logging.spec.ts` and
`harness-repair-dialog.spec.ts` carry the eight-regex set. The others still make
the original single check:

```ts
expect(action.toLowerCase()).not.toContain('delete'); // harness-card.spec.ts:367
expect(action.toLowerCase()).not.toContain('delete'); // harness-blocked-paths.spec.ts:275
```

That is the exact hole Batch 7 recorded as **m1** and Batch 8 closed — but only
on two surfaces. "Remove the occupant" would ship on the Dashboard card and the
Marketplace popover today with a green suite.

This is the more urgent of the two defects. The denylist is weak; a bare
`not.toContain('delete')` is barely a guard at all.

## The fix

**Replace the denylist with an exact-match allowlist on the action string.**

The action text is a fixed literal in each of the five surfaces. Assert equality
against a single shared constant rather than scanning for forbidden words:

- One exported constant holds the approved action sentence.
- Each of the five specs asserts its surface renders exactly that string.
- Changing the wording then requires editing the constant, which makes the
  change visible in review as a deliberate re-approval rather than as a passing
  scan.

Brittleness is the feature here. A spec that goes red on any rewording is
correct for an instruction where the wrong wording destroys user data.

Keep the `Move the occupant aside` prefix assertion and the
`read it before you discard anything` / `ptah harness doctor --fix` substring
assertions — they document _why_ the string says what it says, and they survive
the switch to equality at no cost.

## Scope

- One shared approved-action constant, and the five surfaces asserting against it.
- The three surfaces currently on the bare `delete` check brought up to the same
  standard — this is the part that closes a real, currently-open hole.
- Mutation-test it: reword the action to use "purge" and confirm all five specs
  go red. Under the current guard, all five stay green.

## Note

The wording rule applies to the whole line, not just the action clause. Batch
12 of TASK_2026_306 inserted a sentence into the middle of that paragraph, and
an action-only check would have missed a destructive verb placed in `note` or in
a per-path `reason`. Whatever the allowlist covers, keep the whole-line scope.
