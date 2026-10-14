Verdict: REVISE

# Scoped revision 4 plan recheck

## Blocking

1. **New: a failed head read stays undiscoverable when another pending record is listed.** The per-entry handler skips a failed read and names the folder only when *no* record is listed (`implementation-plan-e.md:143-146`). With two candidates, A whose head always returns `EACCES` and B whose head is readable and remains pending, every prompt visits both, lists B, and omits A and the folder notice (`:127-133,143-146`). A durable pending record can therefore remain unnamed indefinitely. **Required change:** emit a folder notice (or a path-specific unreadable notice) whenever any head read fails, even if other pending paths were listed; add the mixed failing/readable, repeated-prompt schedule to the index spec.

## Serious

None within this recheck.

## Moderate

None within this recheck.

## Minor

None within this recheck.

## r3 Blocking dispositions

- **r3 Blocking 1 — RESOLVED.** A prompt starts a names-only rescan once the index is at least 60 s old, keeps the current list available while it runs, and merges this process's published names into the replacement (`implementation-plan-e.md:117-124`). The added test covers B loading before A writes, then a later prompt after 60 s (`:247-249`). A just-published name is retained through a rescan by the `published` merge and sorted insert (`:117-124`).
- **r3 Blocking 2 — RESOLVED for starvation of later entries.** A head error counts as a visit and advances the cursor, so a later readable pending candidate can be reached (`implementation-plan-e.md:128-133,143-146`). The added persistent-`EACCES` test covers that schedule (`:247-249`). The new Blocking finding concerns discovery of the failed entry itself.

Rescan work is names-only, single flight, and outside the 600 ms prompt wait (`implementation-plan-e.md:117-126`); head reads remain capped at ten per prompt (`:128-130`). No ordinary schedule in the stated rescan rules loses a local publication or skips a readable pending candidate forever.
