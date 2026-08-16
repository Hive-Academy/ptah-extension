# Implementation Report — TASK_2026_259

`pruneStaleFiles` destroying user-authored content under `~/.ptah/plugins/`.

Status: implemented, verified, **not committed** — change is in the working tree.

---

## 1. Fix direction chosen: scope the prune to manifest-owned subtrees (direction 1)

Not direction 2 (`ptah-harness-*` exclusion), and not direction 3 (relocation — explicitly
out of scope).

**Why direction 1 over direction 2.** Direction 2 fixes the one reported symptom. Direction 1
fixes the class. Three concrete reasons:

1. **It protects sideloaded plugins too.** `plugins/creating-plugins.md:100` tells users to
   "drop your plugin folder directly into `~/.ptah/plugins/`". That is TASK_2026_258's
   Failure Mode 5 — the docs instruct users into the same data loss by a second route. A
   `ptah-harness-*` exclusion leaves that route open; scoping closes both with one rule. There
   is a spec for each.
2. **It keeps a naming convention out of `platform-core`.** This lib is ports plus three
   logic-light services. Direction 2 would have it hard-code what a harness directory is
   called — a fact owned by `rpc-handlers`/`agent-sdk` — and it cannot import either. The
   scoping rule needs no such knowledge: it reads the manifest it was already handed.
3. **It restores the method's real contract.** `pruneStaleFiles` is a mirror-sync operation.
   Its correct authority is the subtree the mirror populates, not whatever root it was pointed
   at. The old code was not "missing an exclusion"; it was claiming authority it never had.

**The rule.** For each local file not listed in the manifest:

- nested path (`a/b/c`) → delete only if the first segment is a directory the manifest lists
  files under;
- root-level file (`a.md`) → delete only if the manifest itself lists root-level files.

That second clause is what keeps template pruning working. The two mirrors have different
manifest shapes, verified against the live `content-manifest.json`:

```
plugins   → 5 roots (ptah-angular, ptah-core, ptah-nx-saas, ptah-react, ptah-video);
            0 files at root level
templates → 15 files, all at root level; 0 nested
```

So plugins prune per-directory, templates prune flat, and a stray file dropped straight into
`~/.ptah/plugins/` now also survives. One boolean carries that difference; a rule that only
looked at first path segments would have silently disabled template pruning entirely.

**The trade-off, stated plainly.** A plugin directory removed from the manifest upstream is
no longer swept — it lingers until the user deletes it. That is unavoidable from disk alone:
a removed-upstream plugin and a locally-authored one are the same thing on disk. Fixing it
properly needs a ledger of what we previously wrote (store the last manifest's file list in
`.content-cache.json`, prune = previously-written minus currently-listed). That is a real
follow-up, noted in §6 — not smuggled in here. A stale directory is recoverable; user work is
not.

### Fixes 2 and 3

- **try/catch per unlink, continue.** Prune runs at lines 200-201, _before_ any download. One
  EPERM / Windows file lock aborted `doEnsureContent` outright — no plugins, no templates, and
  it recurred identically every launch (258: Serious Issue 2 / Failure Mode 4). Failures now
  log a `console.warn` and the loop continues.
- **`console.debug` per pruned file.** The service has no injected logger (it predates one and
  `platform-core` may not depend on `vscode-core`), so it uses `console.*` throughout —
  `debug` for the routine deletion, `warn` for the failure, matching the file's existing
  convention.

---

## 2. Files changed

| File                                                                                         | Change                                                                                        |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\platform-core\src\content-download.service.ts`      | `pruneStaleFiles` rewritten: manifest-owned scoping, per-unlink try/catch, debug log (+60/-4) |
| `D:\projects\ptah-extension\libs\backend\platform-core\src\content-download.service.spec.ts` | 5 new specs + an `fs` passthrough mock and a `seedFile` helper (+183)                         |

No other file touched. Nothing under `apps/ptah-extension-vscode/assets/plugins/**` or
`.github/skills/**`. No new dependency — the fix reads only the manifest already passed in.

---

## 3. Specs added — `describe('ensureContent — prune scoping')`

None of these seed cache metadata, so `loadCacheMetadata()` returns null and the prune always
runs. That is the same path a `contentHash` change takes in production.

| Spec                                                                   | Asserts                                                                                                                         | Pre-fix        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| does NOT delete harness-authored skills the manifest never lists       | `ptah-harness-my-skill/skills/my-skill/SKILL.md` survives **and** a stale `ptah-core/agents/gone.md` in the same run is deleted | **FAILS**      |
| does NOT delete a sideloaded plugin directory the manifest never lists | `my-own-plugin/.claude-plugin/plugin.json` survives                                                                             | **FAILS**      |
| DOES delete a stale file inside a manifest-owned plugin directory      | `ptah-core/skills/removed-skill/SKILL.md` deleted                                                                               | passes (guard) |
| DOES delete a stale root-level template (flat manifest still swept)    | `templates/agents/removed.template.md` deleted, `frontend.md` downloaded                                                        | passes (guard) |
| an unlink failure is logged and skipped — downloads still run          | unlink attempted, throws EPERM, `success: true`, `pluginsDownloaded: 1`, file on disk, warning logged                           | **FAILS**      |

The two "DOES delete" specs pass **both before and after** — deliberately. They are the guard
against fixing the bug by turning the feature off.

**One test-harness note worth carrying forward.** `jest.spyOn(fs, 'unlinkSync')` does not work
in this Node build — `TypeError: Cannot redefine property: unlinkSync`, the property is
non-configurable. The spec therefore adds a module-level `jest.mock('fs', ...)` that spreads
the real `fs` and routes `unlinkSync` through a swappable `mockUnlinkSyncOverride` (null by
default → delegates to the real implementation, reset in `afterEach`). Everything else still
hits a real sandboxed tmp dir. This is documented in a comment at the mock.

---

## 4. Reproduction

Reproduced as a failing spec, not against a live profile — no `~/.ptah` profile was touched
and no deletion was observed on real user data. The failing-spec evidence, from
`git stash push` on the service file only with the final spec set in place:

```
● ContentDownloadService › ensureContent — prune scoping › does NOT delete harness-authored skills the manifest never lists
  Expected: true
  Received: false
● ContentDownloadService › ensureContent — prune scoping › does NOT delete a sideloaded plugin directory the manifest never lists
  Expected: true
  Received: false
● ContentDownloadService › ensureContent — prune scoping › an unlink failure is logged and skipped — downloads still run
  Expected: true
  Received: false
Tests:       3 failed, 17 passed, 20 total
```

The first two are `fs.existsSync(<user file>) === false` after the run: the mechanism in
`context.md` confirmed. The third is `result.success === false` — the prune throw aborting the
whole refresh, with zero files downloaded. The service file was restored byte-identically
afterwards (`diff --strip-trailing-cr` clean).

---

## 5. Verification — real output

Test target is `test` (`@nx/jest:jest`), per `libs/backend/platform-core/project.json:20`.

```
$ npx nx test platform-core --skip-nx-cache
Test Suites: 29 passed, 29 total
Tests:       4 todo, 507 passed, 511 total
```

```
$ npx nx typecheck platform-core --skip-nx-cache
> tsc --noEmit --project libs/backend/platform-core/tsconfig.lib.json
NX   Successfully ran target typecheck for project @ptah-extension/platform-core
```

```
$ npx nx lint platform-core --skip-nx-cache
✖ 7 problems (0 errors, 7 warnings)
NX   Successfully ran target lint for project @ptah-extension/platform-core
```

```
$ npx prettier --check <both changed files>
All matched files use Prettier code style!
```

The 7 lint warnings are **pre-existing and in other files** — `no-non-null-assertion` in
`cross-process-child.ts` (3), `file-settings-manager.spec.ts` (3), `file-settings-manager.ts`
(1). Zero in either file I touched, and I did not fix them.

The 4 `todo` tests are pre-existing placeholders elsewhere in the project. The count arithmetic:
the suite was 506 total (502 passed + 4 todo) before this change; 5 specs added → 511 total,
507 passed + 4 todo. No pre-existing failure was observed at any point.

---

## 6. Left for later

1. **A write ledger for exact pruning.** Persist the previous manifest's file list in
   `.content-cache.json` and prune "what we wrote and no longer list". That closes the one
   regression this fix accepts (a plugin dropped upstream is no longer swept) and would make
   the directory-scoping heuristic unnecessary. Real change, own task — it alters the cache
   metadata shape and needs a null-safe first run for existing users.
2. **Empty directory skeletons** (258 Failure Mode 6). `unlinkSync` removes files only, so an
   emptied harness directory still renders as a 0-skill ghost plugin in the Configure modal.
   Untouched here — and now much less likely to occur, since the files causing it are no
   longer deleted.
3. **Docs follow-up.** `apps/ptah-docs/src/content/docs/plugins/plugin-storage.md` and
   `plugins/harness-plugins.md` describe pruning as it behaved _before_ this change, and
   `creating-plugins.md:100`'s sideload instruction is no longer a data-loss trap. All three
   need an edit. `context.md:95-97` anticipated this; those files were being edited by another
   worker while this task ran, so I left them alone entirely.
4. **`~/.ptah/plugins/` as a mixed mirror/authoring root** (direction 3) is still the clean
   long-term separation. Explicitly out of scope per the task brief.
