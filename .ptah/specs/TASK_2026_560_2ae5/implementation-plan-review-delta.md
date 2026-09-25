# Implementation plan delta review

Verdict: REVISE

Scope: changed store, error handling, fingerprint and disclosure sections only. RESOLVED means adequately specified, not implemented. `P` denotes this task's `implementation-plan.md`; `H` denotes `libs/backend/harness-sync/src`. The approved lock-free architecture and earlier resolved items are not reopened.

| Item | Status | Evidence |
| --- | --- | --- |
| Residual N1 | RESOLVED | P:29,61-67,182-189 removes locks from capability writes and drops C2a. The ownership operations at `H/lib/lock/file-lock.ts:181-218` are no longer dependencies of the new store. Ordinary updates use atomic replacement at `H/lib/fs/atomic-write.ts:50-70`. Import has a different publication defect, D1 below. |
| N8 | RESOLVED | P:29,164-189 has no PID-based owner or stale recovery. PID remains only a temporary-name component (`H/lib/fs/atomic-write.ts:39-41`), so PID reuse no longer strands a capability lock. |
| N9 | RESOLVED | C4, P:271-275,303,312 specifies direct status-bearing reads and an EACCES test in PR 1 while retaining legacy behavior. It explicitly bypasses the error-swallowing read at `H/lib/targets/mcp/codex-toml-mcp-facet.ts:187-194`. |
| #3 | PARTIAL | C2, P:182-198 avoids shared-document lost updates, but interrupted exclusive creates are permanently skipped and the marker can certify attempted rather than completed imports. D1 prevents approval of crash recovery and migration completeness. |
| #5 | PARTIAL | C4 closes N9; C2/P:205-206 makes malformed non-empty items unverified. However P:194-195 treats empty import artifacts as absent, which can discard an imported OFF and restore an ON default. D1 remains a fail-closed gap. |

## New store defects

### D1 - blocker - interrupted imports can permanently discard OFF decisions

- Section/evidence: C2, `P:191-198,230-232`; defaults at `P:84-90`. Exclusive creation precedes payload writing, existing files are skipped, and the marker follows attempts. This is not the complete-payload publication used by `H/lib/fs/atomic-write.ts:58-63`.
- Scenario: import plans OFF from `disabledMcpjsonServers`. A creates the file and dies before writing. B retries, skips the empty file on EEXIST and writes the marker. Every later read treats the file as absent. A repository-only name remains OFF, but a same-name user-scope declaration or global ON makes effective state ON; the trusted disabled decision was lost. For imported ON, the approval is permanently lost even in the repository-only case.
- Partial payloads are also visible to concurrent readers. A reader fails closed while a write is incomplete, which is safe; after a crash, that non-empty fragment remains unverified indefinitely because retries skip it. A second importer can publish the marker while the first importer still holds an unfinished item. Marker creation itself also needs a defined crash/empty-payload rule.
- Fix: publish complete import payloads atomically without overwriting explicit user state, and mark completion only after every planned entry is valid or superseded by a valid user decision. Treat incomplete publication as unknown, not default. Do not repair by unconditional delete/rewrite, which would race a user replacement. Test interruption before the first byte, during the payload, before marker completion, and an imported OFF whose inherited value is ON.

### D2 - blocker - hashed and literal IDs share a filename namespace

- Section/evidence: C2, `P:171-179,205-206`. Literal `h_` is allowed, and the long-ID fallback uses the same prefix without a reserved namespace.
- Concrete collision: ID `x` repeated 121 times hashes to suffix `79072a47bfaa54e6057a9ee21e0dea64b9edbfd1`. The distinct short ID `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` stays literal. Both map to `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`. Computed with SHA-256 in memory during this review; no filesystem probe was needed.
- Scenario: toggling either server overwrites the other's file; clearing either deletes the other's decision. The content/filename check does not catch this because both IDs legitimately generate that filename. An OFF can silently disappear.
- Fix: use disjoint filename namespaces, e.g. tag every literal encoding and every hash encoding differently, then validate the complete canonical filename from content. Add the exact long/literal pair above to the codec and independent-toggle tests. Ordinary percent encoding correctly distinguishes case and escapes reserved characters; this defect is the fallback namespace, not percent decoding.

## Remaining checks and explicit limitations

- **Clear/import exception:** P:199-201 openly allows stale import to undo a clear. Example: global OFF, old imported ON, another process clears to inherit OFF, delayed import restores workspace ON. This is broader than simultaneous user clicks: the later writer is replaying an older approval. It is an acknowledged limitation, not proof that the current decision is preserved. Marker-last retries mean the window can persist through repeated failures, not just one process lifetime. If clear must supersede migration, retain an explicit inherit tombstone or separate imported state below explicit user decisions. The approved per-item architecture does not require this exception.
- **Concurrent source snapshots:** P:197's claim that two imports necessarily have identical plans is not established: they read mutable approval/declaration files separately (P:98-104). Different snapshots can compete per item. Define that outcome explicitly and test it; do not claim order-independent migration when sources change during import.
- **Windows writes:** P:182-185,226 correctly requires retry then rejection through RPC/UI. `H/lib/fs/atomic-write.ts:63-70` rethrows final rename errors; `H/lib/fs/windows-retry.ts:86-97` retries recognized errors then throws. No additional defect found for EPERM/EBUSY rejection. Actual antivirus/open-handle behavior was not exercised. Import's direct `wx` path must likewise surface failures without committing its marker.
- **MCP fingerprint exclusion:** no new enforcement gap found within this delta. P:209-211 excludes toggle items, not native MCP install intents. Existing harness output reads separate `mcpIntents` (`H/lib/sources/plugin-config-source-resolver.ts:137,150,172`); capability MCP enforcement remains freshly resolved session flags/direct lane configuration (P:58-60,424). Skills/plugins and PluginConfigState remain in the fingerprint (P:255-257). Keep that distinction in tests if future code starts filtering harness MCP output by capability toggles.
- **Disclosure:** proxy not-enforced labels now appear in both the contract and UI/tests (P:145-146,375,394). The cloud-sync and network-filesystem exclusions are explicit (P:213-220); they do not establish the stronger assertion that a crash never widens state, as D1 demonstrates.
- Five logic checks: silent failure = D1/D2; unexpected user action = colliding toggle/clear; wrong-answer input = empty import artifact; dependency failure = rename rejects but interrupted import cannot recover; missing contract = precedence of clear and differing concurrent import snapshots.
- No source or git state changes, live provider sessions, or filesystem mutation tests. Only this deliverable was written. This is a delta review, not a fresh approval of the entire plan.
