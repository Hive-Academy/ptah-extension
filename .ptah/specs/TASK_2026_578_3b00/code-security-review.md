# Code Security Review — `TASK_2026_578_3b00`

## Batch 5

### Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Verdict             | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Minor issues        | 1                                    |

### Scope

Files reviewed:

- `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts`
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.spec.ts`
- `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts`
- `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.spec.ts`

Verification run:

- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-md-generator` → 29 passed
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-synthesizer` → 37 passed

### Checks performed

1. **Path traversal on reference names** — traced every call site that consumes `SkillReference.name`.
2. **Write ordering** — verified whether all references are validated before the first disk write.
3. **`removeActive` root escape** — checked whether the deletion target is constrained to the active root.
4. **Slug derivation** — traced model-provided names through `sanitizeSlug` and the `-2..-5` collision suffix logic.
5. **Size limits** — verified bounds on bodies, reference counts, and member counts.
6. **Prompt injection surface** — verified whether member bodies or reference content can reach the system prompt.

### What is working

- The reference-name regex `^[a-z0-9][a-z0-9-]{0,59}$` is **anchored** and shared as a single constant (`SKILL_REFERENCE_NAME_PATTERN` in `skill-md-generator.ts`, imported into `skill-synthesizer.service.ts`).
- The regex blocks `../x`, `a/b`, backslashes, absolute paths, empty names, uppercase letters, leading hyphens, and names over 60 characters.
- Zod validates reference names at the LLM boundary (`UmbrellaSkillSchema`, `skill-synthesizer.service.ts:110`) and the generator re-checks them at the filesystem boundary (`validateReferences`, `skill-md-generator.ts:305`).
- Duplicate reference names are rejected at both boundaries (`skill-synthesizer.service.ts:116-118`, `skill-md-generator.ts:310-314`).
- `writeAtRoot` validates **all** references before any `mkdirSync` or `writeFileSync` (`skill-md-generator.ts:250-252`), so a bad reference cannot leave a partial skill directory.
- `slug` is sanitized to `[a-z0-9-]{1,60}` via `sanitizeSlug` (`skill-md-generator.ts:359-365`) before any path operation; model-provided skill names cannot escape the active root through the slug.
- Reference bodies are capped at 20 000 chars (`UMBRELLA_REFERENCE_MAX_CHARS`, `skill-synthesizer.service.ts:95`), reference count at 8 (`UMBRELLA_MAX_REFERENCES`, line 93), umbrella members at 12 (`UMBRELLA_MAX_MEMBERS`, line 91), and each member body is clipped to 3 000 chars (`CLUSTER_MEMBER_MAX_CHARS`, line 88).
- Umbrella member bodies are placed in the **user** prompt built by `buildUmbrellaPrompt` (`skill-synthesizer.service.ts:513-527`), while the system prompt is the hardcoded `UMBRELLA_SYSTEM_PROMPT` (line 156). Untrusted text cannot alter the system prompt in this batch.

---

## Findings

### MODERATE — `overwriteCandidate` accepts `references` but neither validates nor writes them

- **File:** `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:192-216`
- **Evidence:** `overwriteCandidate` takes `SkillMdInput`, which includes `references?: readonly SkillReference[]`. The method calls `this.sanitizeSlug`, `fs.mkdirSync`, and `fs.writeFileSync` but never invokes `validateReferences`, and it writes no `references/` directory.
- **Scenario:** A caller (or future refactor) that expects `overwriteCandidate` to mirror `writeCandidate`/`promoteToActive` behavior could silently drop reference documents. More importantly, this is the only generator method that performs path operations on a `SkillMdInput` without enforcing the reference-name contract, creating a latent path-traversal hole if someone later adds reference writing here without adding validation.
- **Current impact:** No traversal occurs today because references are ignored entirely.
- **Fix:** Either reject `references` explicitly (throw if non-empty) or call `this.validateReferences(input.references ?? [])` before any disk operation and write the reference files exactly as `writeAtRoot` does, so the security contract is uniform across all three generator entry points.

### MODERATE — Windows reserved device names pass the reference-name regex

- **File:** `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:42`
- **Evidence:** `SKILL_REFERENCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/` accepts `con`, `aux`, `nul`, `prn`, `com1`–`com9`, and `lpt1`–`lpt9`. `writeAtRoot` later joins these into `references/<name>.md` (`skill-md-generator.ts:280`).
- **Scenario:** On Windows, creating a file whose base name is a reserved device name (even with an extension such as `con.md`) is reserved by the operating system. `fs.writeFileSync(path.join(referencesDir, 'con.md'), ...)` can hang, throw `EPERM`/`EACCES`, or be redirected to the console device instead of creating a regular file. An LLM that emits a reference named `con` can cause a synthesis operation to fail or behave unpredictibly on Windows hosts.
- **Current impact:** Not an arbitrary-file-write, but a platform-specific denial-of-service / unexpected-destination issue.
- **Fix:** Add a Windows reserved-name deny-list check inside `validateReferences` (or as an additional regex constraint) and reject names like `con`, `aux`, `nul`, `prn`, `com1`–`com9`, `lpt1`–`lpt9`, with and without trailing digits.

### MINOR — `removeActive` trusts the caller-supplied `MaterializedSkill.dir` without verifying it lies under the active root

- **File:** `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:241-243`
- **Evidence:**
  ```ts
  removeActive(materialized: MaterializedSkill): void {
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
  ```
- **Scenario:** `MaterializedSkill` is a public interface. A compromised or buggy caller can construct `{ dir: '/etc' }` (or `C:\Windows`) and delete an arbitrary directory. Under normal generator usage the slug is sanitized, so the model cannot directly create such a value; the risk is defense-in-depth.
- **Current impact:** Requires a malicious caller; not directly model-exploitable.
- **Fix:** Verify `path.resolve(materialized.dir).startsWith(path.resolve(this.activeRoot()) + path.sep)` before calling `rmSync`, and throw a clear error if the directory is outside the active root.

---

## Verdict

- **Recommendation:** APPROVED
- **Confidence:** HIGH
- **Top risk:** A future edit to `overwriteCandidate` that adds reference writing without validation could reintroduce the path-traversal vector that the rest of the generator already mitigates.
- **What a robust implementation would add:**
  1. Uniform reference handling in `overwriteCandidate` (validate-and-write or reject).
  2. A Windows reserved-device-name block in `validateReferences`.
  3. A root-prefix guard in `removeActive`.


---

## Batch 7

### Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 6/10                                 |
| Verdict             | NEEDS_REVISION                       |
| Blocking issues     | 0                                    |
| Serious issues      | 2                                    |
| Moderate issues     | 2                                    |
| Minor issues        | 1                                    |

### Scope

Files reviewed:

- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.spec.ts`

Verification run:

- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-retirement` → 15 passed (15 total)

---

### Detailed Analysis & Core Questions

#### 1. Path Containment Check (`removeActiveDir`)
- **Evidence:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:232-256`
  ```ts
  const root = path.resolve(this.mdGenerator.activeRoot());
  const dir = path.resolve(path.dirname(row.bodyPath));
  const relative = path.relative(root, dir);
  const contained =
    row.name.length > 0 &&
    relative === row.name &&
    path.basename(dir) === row.name &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative);
  ```
- **Evaluation across edge cases:**
  - **Empty name (`""`):** Handled (`row.name.length > 0` at line 237).
  - **Root folder itself (`dir === root`):** `path.relative(root, root)` yields `""`. Since `row.name.length > 0`, `relative === row.name` fails (`"" !== row.name`). The root directory is never deleted.
  - **Parent traversal (`..`):** Prevented by `!relative.startsWith('..')` (line 240) and `path.basename(dir) === row.name`.
  - **Separators (`/`, `\\`) / Nested paths:** If `row.bodyPath` points to `<root>/sub/skill/SKILL.md`, `relative` is `sub/skill`, but `path.basename(dir)` is `skill`. If `row.name` is `skill`, `relative === row.name` fails (`sub/skill !== skill`). If `row.name` contains `/`, `path.basename(dir)` strips slashes and will never match `row.name`. Only direct children match.
  - **Drive letters / network paths / absolute paths:** On Windows, if `root` is on `C:` and `dir` is on `D:`, `path.relative` returns the absolute target path. `!path.isAbsolute(relative)` (line 241) rejects it.
  - **Letter case on case-insensitive filesystems:** `relative === row.name` and `path.basename(dir) === row.name` perform strict string equality (`===`). If case differs on disk, `contained` is `false`, failing closed.
  - **Trailing dot or space on Windows:** Win32 strips trailing dots and spaces. Synthesized skill slugs are sanitized by `sanitizeSlug` to `^[a-z0-9][a-z0-9-]{0,59}$`, so dots/spaces cannot originate internally.
  - **Symbolic links / junctions:** Neither `activeRoot()` nor `dir` is checked with `fs.realpathSync`. In Node.js, `fs.rmSync(dir, { recursive: true })` on a symlink or junction deletes the link without deleting the target. However, if `activeRoot` is reached through a symlink while `row.bodyPath` holds a canonical path (or vice versa), `path.relative` will produce `..` prefixes, causing `removeActiveDir` to fail-closed and leave the directory intact.

#### 2. Author/Diverged/Pinned Exemptions
- **Evidence:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:116-123, 267-294`
- **Pinned skills:** Checked at line 116 (`if (row.pinned) { skippedPinned++; continue; }`). Pinned rows are safely skipped during `run()`.
- **Registry read failure:** Handled at lines 287-293. If `this.registry.listAll()` throws, `readExemptSlugs()` catches the error, logs a warning, and returns `null`. Line 102 then halts the pass (`if (exemptSlugs === null) return EMPTY_RESULT;`). Authored skills remain protected.
- **Unbound registry (CLI hosts):** **VULNERABLE (SERIOUS)**. At lines 268-273, if `this.registry` is null, `readExemptSlugs()` returns `new Set<string>()`. The sweep proceeds with no exempt slugs. Any unpinned `authored` or `diverged` skill idle past `retireAfterDays` has its active directory deleted and row rejected.
- **Registry kind & letter-case:** Line 281 checks `entry.kind === 'skill'`. However, `exemptSlugs.has(row.name)` (line 120) is case-sensitive. If a user registered or edited a skill whose slug casing differs between SQLite tables, the exemption lookup fails.
- **TOCTOU race on new registry rows:** `readExemptSlugs()` is called once at line 101. If a skill is edited to `diverged` during the sweep, `retire(row, now)` does not re-check the registry prior to `removeActiveDir(row)`.

#### 3. Execution Order (Disk Deletion Before DB Transaction)
- **Evidence:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:204-224`
  ```ts
  if (!this.removeActiveDir(row)) return false;

  const won = this.store.inImmediateTransaction(() => {
    const rejected = this.store.rejectIfStatus(
      row.id,
      'promoted',
      RETIRED_UNUSED_REASON,
      now,
    );
    if (rejected) this.registry?.remove('skill', row.name);
    return rejected;
  });
  ```
- **Impact & window:**
  - `fs.rmSync` deletes `<activeRoot>/<slug>` **before** `inImmediateTransaction` acquires the SQLite write lock.
  - If another host/process modified `row.status` (e.g. unpromoted, transitioned, or merged) or updated the candidate concurrently, `this.store.rejectIfStatus` returns `false`.
  - In that case, `won === false`, but the folder is **already deleted**. The candidate row remains in SQLite in its previous state, while its disk files are permanently lost.
  - Window size: spans the full duration of recursive filesystem deletion and directory unlinking plus SQLite transaction acquisition (typically 5–100ms, higher under I/O load).
  - Two hosts racing on retirement: If two retirement sweeps race, both execute `removeActiveDir` (idempotent with `force: true`); one wins the transaction and one loses. That specific collision is benign. However, racing against a non-retirement status update leads to unrecoverable file loss.

#### 4. `removeMaterializations` Path Containment
- **Evidence:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:171-193`
- `removeMaterializations(rows, origin)` iterates over `rows` and calls `this.removeActiveDir(row)` at line 178.
- It enforces the **exact same** path check: only folders directly under `<activeRoot>` matching `row.name` are removed.
- Callers: Designed for the umbrella synthesis accept workflow (to remove directories of merged member skills). Note that unlike `run()`, it does not check `exemptSlugs` or `row.pinned`, assuming the caller has already validated and decided those rows.

#### 5. Settings Contract (N=1, M=1)
- **Evidence:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:53, 104-106`
- `RetirementDaysSchema = z.number().int().min(1).max(3650);`
- `dormantAfterDays = 1`, `retireAfterDays = 1 + 1 = 2`.
- Retiring a skill idle for 2 days under `N=1, M=1` is **within the documented contract** (`min(1)`), though aggressive.

#### 6. Log File Data Exposure
- **Evidence:** Traced all logger calls across lines 134-141, 146-151, 180-188, 218-221, 243-251, 269-271, 288-291, 311-318, 323-326, 350-353, 364-367.
- **Result:** No log statement outputs skill markdown bodies, instructions, or prompt text. Only identifiers (`candidateId`, `slug`, `bodyPath`, `activeRoot`, `error`, settings keys/values) are logged.

---

### Findings

#### SERIOUS — Unbound registry on CLI hosts bypasses `authored`/`diverged` exemption
- **File:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:268-273`
- **Evidence:**
  ```ts
  if (!this.registry) {
    this.logger.warn(
      '[skill-synthesis] no skill registry bound; retirement exempts pinned skills only',
    );
    return new Set<string>();
  }
  ```
- **Scenario:** On CLI/headless hosts where `SkillRegistryStore` is not bound, `readExemptSlugs()` returns an empty `Set`. When `run()` executes, unpinned skills authored or customized by the user (`cloneStatus === 'authored' | 'diverged'`) are not exempted. If idle for `retireAfterDays`, their directories are deleted via `fs.rmSync` and their rows rejected. This directly breaks the core safety invariant that user-owned skills must never be deleted by automated retirement.
- **Impact:** Permanent loss of user-authored or user-modified skills when retirement runs on a host without an active registry binding.
- **Fix:** If `this.registry` is null, fail-safe by returning `null` (skipping the retirement pass entirely, mirroring line 289), or only permit retirement of skills whose candidate metadata provably verifies they are pure synthetic skills without user ownership.

#### SERIOUS — Active directory deletion before DB transaction causes irreversible data loss on race conditions
- **File:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:205-216`
- **Evidence:**
  ```ts
  if (!this.removeActiveDir(row)) return false;

  const won = this.store.inImmediateTransaction(() => {
    const rejected = this.store.rejectIfStatus(
      row.id,
      'promoted',
      RETIRED_UNUSED_REASON,
      now,
    );
  ```
- **Scenario:** `removeActiveDir(row)` permanently deletes the on-disk directory before entering `inImmediateTransaction`. If another host or concurrent operation changed `row.status` (e.g. unpromoted, re-promoted, merged, or modified) between the query and this transaction, `this.store.rejectIfStatus` returns `false`. `won` is `false`, but the skill's disk files are already gone.
- **Impact:** Filesystem data loss while the SQLite store retains an un-retired candidate row.
- **Fix:** Perform a two-phase update or acquire the database lock and transition the candidate state to a retiring status *before* permanently deleting the directory on disk. If `fs.rmSync` throws, roll back or flag for repair.

#### MODERATE — Case-sensitive slug lookup in `exemptSlugs` risks missing exemptions
- **File:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:120, 277-286`
- **Evidence:** `entry.slug` is placed into `exemptSlugs` (a `Set<string>`), and checked with `exemptSlugs.has(row.name)`.
- **Scenario:** On Windows/macOS filesystems that are case-insensitive, if a skill was registered or manually entered with different casing (e.g., `My-Skill` vs `my-skill`), `Set.has` returns `false`. The exemption is bypassed, and if the path check matches the filesystem path, the skill is deleted.
- **Fix:** Normalize slugs using `.toLowerCase()` when populating `exemptSlugs` and when checking `row.name.toLowerCase()`.

#### MODERATE — TOCTOU window between initial exemption snapshot and retirement execution
- **File:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:101, 204-206`
- **Evidence:** `exemptSlugs` is populated once at `run()` entry.
- **Scenario:** If a user modifies an idle skill during a long-running sweep (marking it `diverged` in the registry), `exemptSlugs` does not contain the updated slug. `retire(row)` does not consult the registry before calling `removeActiveDir(row)`.
- **Fix:** Re-check `this.registry.getBySlug('skill', row.name)` immediately prior to deletion in `retire()`.

#### MINOR — `removeActiveDir` uses lexical `path.resolve` without symlink canonicalization
- **File:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:233-234`
- **Evidence:** Uses `path.resolve` rather than `fs.realpathSync`.
- **Scenario:** If `activeRoot` is a junction/symlink and `row.bodyPath` was stored using a resolved target path (or vice versa), `path.relative` will produce `..` and refuse to delete valid skills.
- **Fix:** Use `fs.realpathSync.native` on both `root` and `dir` when they exist on disk.

---

### Verdict

- **Recommendation:** NEEDS_REVISION
- **Confidence:** HIGH
- **Top risk:** Running retirement on CLI hosts without a bound registry deletes user-authored or user-diverged skill directories.
- **What a robust implementation would add:**
  1. Abort the retirement pass when `this.registry` is null (fail-safe like registry read failure).
  2. Guard against file deletion before transaction confirmation (two-phase status transition or DB-first locking).
  3. Case-insensitive slug normalization for `exemptSlugs`.

---

### Batch 7 re-review

Re-review of `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts` and its `.spec.ts` after the fix-up. The original reviewer was unavailable; this pass takes over the earlier `## Batch 7` verdict (NEEDS_REVISION, 6/10).

Verification run: `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-retirement` → **22 passed** (was 15 at the original review).

#### Status of the earlier findings

**SERIOUS 1 — Unbound registry bypasses `authored`/`diverged` exemption: RESOLVED.**

- `readExemptSlugs()` now returns `null` when no registry is bound, with a warn (`skill-retirement.service.ts:335-339`), and `run()` skips the whole pass with `skippedReason: 'registry-unavailable'` (`skill-retirement.service.ts:111-114`). An unreadable registry was already `null` (`:354-359`), so both unbound and read-failure now fail closed identically.
- Spec evidence: `'skips the pass when no registry is bound (fails closed)'` (`skill-retirement.service.spec.ts:450-471`) asserts no dormancy, no retirement, directories kept, and the warn. `'skips the pass when the registry cannot be read'` (`:561-572`) covers the read-failure twin.
- Reachability confirmed as test-only: `SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE` is registered unconditionally in `registerSkillSynthesisServices` (`di/register.ts:151-153`), and `register.spec.ts:35-44` fails if any declared token goes unwired. The `registry === null` path requires manual construction outside the real composition.
- Note (not a finding): this deviates from the plan's stated failure behaviour ("a missing registry means pinned-only exemption, after a warn", `implementation-plan.md:791-792`) toward fail-closed. The deviation is deliberate and strictly safer: without knowing which skills the user owns, running the sweep risks deleting authored content, and dormancy transitions on such a host are an acceptable casualty. The `skippedReason` field (`:68`, `:113`) makes the skip observable to callers.

**SERIOUS 2 — Directory deletion before the DB transaction: REDUCED TO MODERATE.**

- The orchestrator kept the approved folder-first order (`implementation-plan.md:741-749`: crash self-heal — `rmSync` with `force` is idempotent, the DB move retries next pass). I accept the stated reason for rejecting DB-first: a failed `rmSync` after the row left `'promoted'` leaves an orphan folder **no later pass ever finds**, because retirement only visits `status = 'promoted'` rows (`skill-candidate.store.ts:615`). That is a permanent orphan; folder-first's failure mode (promoted row, missing folder) self-heals on the next pass.
- The added re-check `stillRetirable()` (`skill-retirement.service.ts:269-290`) runs immediately before `removeActiveDir`: it re-reads the row via `store.findById` (still `'promoted'`, not pinned, `:270-272`) and re-reads the registry via `listAll` (slug not `authored`/`diverged`, case-insensitive, `:273-275`). A failed check logs and skips with nothing deleted (`:276-287`). Spec evidence: `'decided-meanwhile'` (`spec.ts:412-429`) and `'diverged-meanwhile'` (`spec.ts:431-448`).
- The DB side remains fully guarded: `rejectIfStatus` is a compare-and-set on `status = 'promoted'` (`skill-candidate.store.ts:684-698`), and `registry.remove` only deletes `clone_status = 'synth'` rows (`skill-registry.store.ts:196-208`), so no concurrent writer's DB state can be corrupted by a lost race — the loser writes nothing (`:255-261`, spec `:269-282`).
- **The remaining window, precisely.** Between `stillRetirable`'s two reads returning and `fs.rmSync(dir, …)` completing at `skill-retirement.service.ts:319`, a concurrent writer on the same SQLite connection (a second sweep in another process sharing the DB, the accept path, a pin, or a user edit landing in that window) can change state that the re-check will not see:
  - **Row decided or pinned** → the folder is deleted anyway; `rejectIfStatus` loses; the row survives in its new state without its directory. If the concurrent decision was a merge-accept, its own `removeMaterializations` would have removed the folder anyway (benign overlap). If the row was rejected with another reason, it is no longer `'promoted'`, so **no later pass retires it and the DB move never self-heals** — that is the residual irreducible loss case. If it was pinned, the row stays `'promoted'` and the next pass re-runs the whole unit (self-heal).
  - **Registry row turned `authored`/`diverged`** → the folder — now user-owned content — is deleted; the row is still rejected (the compare-and-set only checks status); the guarded `registry.remove` keeps the `authored`/`diverged` registry row, so the ownership record survives but the content does not. This is the sharpest residual.
  - Both require a write landing inside a window bounded by the two reads plus the recursive `rmSync` (typically low ms; more under I/O load). The pre-fix window spanned the **entire sweep** since the single snapshot at `:111`. Shrinking it by 3–4 orders of magnitude, on a code path whose DB half was never corruptible and whose crash half self-heals, takes this out of SERIOUS: the pre-fix finding was "whole-sweep window plus DB corruption on loss"; what remains is a millisecond-scale race with a concurrent writer that needs to land in exactly that gap.
- Verdict: MODERATE. Closing it fully would need a two-phase status (e.g. a `'retiring'` state written in a transaction before `rmSync`, reconciled next pass), which is a design change beyond this fix-up and not warranted by the residual probability.

**MODERATE — TOCTOU between the exemption snapshot and retirement: RESOLVED.**

Covered by the same re-check: `retire()` re-reads the registry through `stillRetirable` before any deletion (`skill-retirement.service.ts:242`, `:273-275`). The spec case `'diverged-meanwhile'` (`spec.ts:431-448`) flips the registry row to `diverged` after the pass's first `listAll` and proves the directory is kept. Only the millisecond residual window of SERIOUS 2 remains.

**MODERATE — Case-sensitive slug lookup misses exemptions: RESOLVED.**

`entry.slug` is lowercased when the set is built (`skill-retirement.service.ts:352`) and both lookups use `row.name.toLowerCase()` (`:133` in `run()`, `:275` in `stillRetirable`). Spec case `'exempts a row whose registry slug differs only in case'` (`spec.ts:399-410`, registry row `'My-Skill'`, candidate `'my-skill'`) proves the exemption holds. One residual, filed as MINOR below: the cleanup `registry.remove` call is not case-normalized.

**MINOR — Lexical `path.resolve` without symlink canonicalization: OPEN (accepted).**

Unchanged, as declared. The check still fails closed: a symlink/junction mismatch between `activeRoot()` and `bodyPath` produces `..`-prefixed or absolute `relative` and the directory is kept (`skill-retirement.service.ts:300-317`). No deletion occurs through a false positive; the cost is a skill that is never retired. Remaining at MINOR is correct.

#### New findings

**MINOR — `stillRetirable` does not re-check the idle clock.**

- **File:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:269-290`.
- The re-check verifies status, pin and registry ownership, but not `lastUsedAt`: a `skill_invocation_events` row recorded between the sweep's snapshot (`listPromotedLastUse`, `skill-candidate.store.ts:604-623`) and `retire()` resets the idle clock without stopping the retirement. A skill used a moment ago — but idle ≥ N+M per the stale snapshot — has its directory deleted and its row rejected. Re-checking `MAX(invoked_at)` for the slug (or reusing `listPromotedLastUse`'s join for the single row) would close it.
- Probability is low: the row must already be idle past the full retirement threshold and be invoked inside the sweep window. Recorded as residual, not blocking.

**MINOR — `registry.remove` on retirement is not case-normalized.**

- **File:** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:252`.
- The guarded delete runs against the case-sensitive `(kind, slug)` PK with the raw `row.name`, while the exemption path is now case-insensitive. A `synth` registry row whose slug casing differs from the candidate slug (conceivable via catalog sync, which derives slugs from on-disk clone folder names, `skill-registry-catalog.service.ts:58-79`, e.g. after a hand rename on a case-insensitive filesystem) survives retirement as a stale row pointing at a rejected candidate and a removed `user_path`. Catalog sync is upsert-only, so nothing reaps it. Data-hygiene residue, not deletion of user content — and note `removeActiveDir`'s strict `basename === row.name` check (`:304`) means the mismatched-casing directory itself is never deleted, failing closed.

**Note (no action):** `stillRetirable` calls `readExemptSlugs()` — a full `listAll` — once per retirement-due row. O(due × registry) reads per pass is negligible at expected scale (a daily sweep over tens of skills), and the unbound-registry warn cannot fire per-row because `run()` returns early at `:111-114`.

#### R-f / R-f2 confirmation

Both still hold. The transaction callback at `skill-retirement.service.ts:245-254` contains only `store.rejectIfStatus` (one plain UPDATE, `skill-candidate.store.ts:684-698`) and `registry?.remove` (one plain DELETE, `skill-registry.store.ts:196-208`) — neither opens its own transaction, satisfying R-f. There is no `catch` inside the callback; a throw propagates, rolls back the `BEGIN IMMEDIATE` unit, and reaches the per-row catch at `:146-157`, satisfying R-f2. Spec case `'leaves no partial write when the transaction throws mid-callback (R-f2)'` (`spec.ts:533-559`) proves the rollback (`status` back to `'promoted'`, registry row intact) and that the loop continues to the next row.

#### Summary

| Metric              | Value   |
| ------------------- | ------- |
| Overall score       | 8/10    |
| Verdict             | APPROVED |
| Blocking issues     | 0       |
| Serious issues      | 0       |
| Moderate issues     | 1       |
| Minor issues        | 3       |

Scoring rationale: one SERIOUS resolved outright (fail-closed registry, with the unconditional DI registration verified at `register.ts:151-153`), the other reduced to MODERATE on a documented, plan-approved ordering whose residual is a millisecond race rather than a whole-sweep window, and both MODERATEs resolved with spec evidence. The 8 rather than 9–10 is separated by the three residual MINORs — the idle-clock re-check gap, the case-sensitive registry cleanup, and the open symlink item — all of which fail closed or cost hygiene rather than data.

- **Recommendation:** APPROVED
- **Confidence:** HIGH
- **Top residual risk:** a concurrent writer landing in the millisecond gap between `stillRetirable`'s reads and `rmSync` can still cost a directory the DB then declines to retire (or, sharpest, a just-turned-`diverged` skill's folder), bounded to that gap instead of the whole sweep.
- **What a robust implementation would add:** a `'retiring'` two-phase status to close the deletion race entirely, an idle-clock re-check inside `stillRetirable`, and a case-insensitive registry cleanup on the retirement path.
