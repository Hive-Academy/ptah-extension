## Verdict

**REVISE — 7/10.** The correction fixes the reported sequential A1/A2/B1 interleaving, but it does not guarantee that a newer row from another instance is kept when the two instances write concurrently or when the new row read fails. This is a read-only review; I did not run tests or verification.

## Defect status

**PARTIAL — cross-instance overwrite.** `persistLastRun` now reads the stored JSON and uses local sequence only when the row still equals this instance's last write (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:955-977`). Thus A2 settling *after* B1 has already committed skips its write when B1 has a later `startedAt`. The new test exercises that order (`indexing-control.service.spec.ts:1677-1713`). However, the read and unconditional update are separate operations (`indexing-control.service.ts:960-976,1330-1339`): A2 can read A1, B1 can commit, then A2 can update and replace B1. A conditional update or transaction that rechecks the row at write time is needed to close that race.

The correction preserves the listed local guarantees in the inspected path. A census settles once on final participant release (`indexing-control.service.ts:830-850`), calls `persistLastRun` once and selects at most one terminal push (`:860-940`); a stale result skips the write (`:969-974`). When the stored JSON still equals this instance's last write, sequence ordering allows a newer census through despite clock rollback and skips an older manual census (`:961-968`); the clock rollback case is exercised at `indexing-control.service.spec.ts:1645-1659`. If another instance has already committed a newer row before this instance's read, the persisted `startedAt` check keeps it (`indexing-control.service.ts:965-968`); the earlier case is exercised at `indexing-control.service.spec.ts:1661-1675`.

## New findings

1. **Moderate — a failed row read can bypass the new ordering guard.** `readRow` converts every SQLite read error to `null` (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1257-1266`). The new per-write call then treats `storedJson` as absent, finds no stale row, and may issue a successful update over a newer row (`:960-977`). This failure path was introduced by making the guard depend on the read. **Fix:** distinguish a missing row from a failed read; on read failure, return a failed persistence result and avoid the update and success push. Add a focused read-error test.
