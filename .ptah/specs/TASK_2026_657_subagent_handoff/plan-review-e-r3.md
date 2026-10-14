Verdict: REVISE

# Option E revision 3 design review

Scope: `implementation-plan-e.md` revision 3, `decisions.md:47-71`, r2 findings, and targeted reads of the stated worktree at 74347fc75. Plan review only; no source edits, tests, builds, or git operations.

## Blocking

1. **B3 PARTIAL — a pending record written by another host can stay invisible forever.** The index loads each workspace directory once into `names` and only merges this process's `publish` calls (`implementation-plan-e.md:117-120`). Schedule: host B loads the index, host A writes a record and exits, then B receives repeated main-thread prompts. B never rescans, so neither its cursor nor its takeover text can name A's pending record (`:121-138,169-171`). **Required:** provide a bounded refresh or incremental rescan that eventually incorporates external writes, then test two hosts with B loading before A writes and A exiting before B prompts.

2. **New — one unreadable record can starve every record behind it.** The pointer starts after its saved cursor and reads heads in order; it updates the cursor only after the loop, while any read error returns `undefined` for that prompt (`implementation-plan-e.md:123-129,139`). Schedule: the first indexed file repeatedly returns `EACCES` or another read error; every prompt retries it, aborts before cursor advancement, and never names later pending paths. **Required:** handle head-read failure per entry, advance past that name, and retain a discoverable folder notice if no path can be listed. Test a persistent read failure before a valid pending record.

## Serious

None beyond the blocking findings.

## Moderate

None requiring revision under the binding decisions.

## Minor

- **S5 deviation: verify the stated tool-id uniqueness assumption during implementation.** The writer map is keyed by tool-use id alone (`implementation-plan-e.md:60-63,104-106`), matching the existing registry lookup (`subagent-budget-monitor.ts:775-777`). The plan explicitly leaves SDK uniqueness for the implementer to confirm (`implementation-plan-e.md:62-63`). If ids can recur across unrelated live sessions, key the map by an identity that preserves rekey sharing without sharing unrelated handoffs. This is an implementation check, not a claimed current collision.

## R2 disposition

| Item | Status | Evidence and effect |
| --- | --- | --- |
| B1 | RESOLVED | `markInvoked` precedes `stopSubagent`; release and give-up retain the record, including ambiguous rejection (`implementation-plan-e.md:43,53-59,93-94,100-106,162-165`; dispatcher rejects ambiguously at `subagent-message-dispatcher.ts:319-327`). |
| B3 | PARTIAL | Uncapped names and cursor fix the old 2,000/first-ten starvation (`implementation-plan-e.md:117-129`), but the one-time load misses later cross-process writes (Blocking 1). |
| S1 | RESOLVED | Filename owner is a hash of the unsanitized session id; live aliases are compared as hashes (`implementation-plan-e.md:69-75,169-171`). Distinct `a.b` and `a_b` no longer collapse through sanitization. |
| S2 | RESOLVED | Audience comes from the filename; malformed status stays pending and cannot change owner (`implementation-plan-e.md:74-81,126-135`). |
| S3 | RESOLVED within accepted limit | Foreign paths carry explicit takeover instructions without inferring cross-process death (`implementation-plan-e.md:46-49,134-135`; `decisions.md:62-64`). Blocking 1 still prevents some such paths being discovered. |
| S5 | RESOLVED for rekeyed concurrent stops | A synchronously reserved map by tool id shares the pending write across both stops (`implementation-plan-e.md:60-63,104-106`; merge by tool id at `subagent-budget-monitor.ts:535-558`). Confirm the assumption noted above. |
| M2 | RESOLVED to the chosen contract | Load reads names only, the 600 ms timeout names the folder, and prompt reads at most ten heads (`implementation-plan-e.md:117-125,136-140`; `decisions.md:55-58`). |

## Revision 3 deviations and accepted limits

- **B1 “invoked” — RESOLVED:** conservatively means `stopSubagent` called; withdrawal is limited to pre-call cases (`implementation-plan-e.md:53-57,162-165`). The dispatcher can reject before `stopTask`, so retaining that record can yield a dismissible false positive (`subagent-message-dispatcher.ts:298-327`).
- **B1 publication — RESOLVED to the stated deviation:** publish after `stopSubagent` returns or rejects, including rejection; a restart reloads the durable record (`implementation-plan-e.md:58-59,117-120,162-165`).
- **S5 writer key — RESOLVED subject to the explicit SDK-id check:** tool-use id alone allows pre-rekey sharing (`implementation-plan-e.md:60-63,104-106`).
- **B3 cursor — RESOLVED for indexed records:** cursor is per process, workspace, and prompting session, so prompts from one session do not advance another's cursor (`implementation-plan-e.md:64-65,117-129,169-171`).
- **B2, S4, M1 — documented accepted limits:** safety-stop loss requires disk-write and send failure; workspace is trusted against ancestor swaps; cleanup touches only resolved records older than seven days (`implementation-plan-e.md:38-49,126-128`; `decisions.md:49-51,65-71`).

The score is 5/10: the revised stop and audience contracts are coherent, but two ordinary pointer schedules can still leave a durable pending handoff unnamed. This is above 3-4 because records remain on disk and the defects are confined to discovery; below 7-8 because eventual discovery is a central requirement.


