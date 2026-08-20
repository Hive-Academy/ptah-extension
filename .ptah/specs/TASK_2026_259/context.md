# Context — TASK_2026_259

## Origin

Surfaced by the `technical-content-writer` correcting `plugins/plugin-storage.md` during
TASK_2026_258. It documented the pruning rule and added a "keep a copy of anything
irreplaceable" caution, but explicitly declined to assert the deletion as observed
behaviour because it had not run it — the right call. The orchestrator then read the code
path and confirmed the mechanism. It is still **unreproduced against a real profile**.

## The code path

```
content-download.service.ts:84   this.pluginsDir = path.join(this.ptahDir, 'plugins');   // ~/.ptah/plugins
content-download.service.ts:200  this.pruneStaleFiles(this.pluginsDir, manifest.plugins.files);
content-download.service.ts:265  private pruneStaleFiles(localDir, manifestFiles) {
                                   const manifestSet = new Set(manifestFiles);
                                   const localFiles = this.walkLocalDir(localDir, localDir);
                                   for (const relPath of localFiles)
                                     if (!manifestSet.has(relPath)) fs.unlinkSync(...);
                                 }
```

`pruneStaleFiles` is handed the **plugins root**, not a per-plugin subdirectory, and
`walkLocalDir` recurses the whole tree. Its contract is "delete anything here that the
remote manifest does not list" — correct for a directory that only ever holds mirrored
remote content, and wrong the moment anything local lives there.

## What else lives there

The harness wizard writes user-authored skills into exactly that tree:

```
harness-fs.service.ts:6,47   ~/.ptah/plugins/ptah-harness-{slug}/skills/{slug}/SKILL.md
```

Also written by the `ptah_harness_create_skill` tool
(`libs/backend/vscode-lm-tools/.../harness-namespace.builder.ts:302-349`).

These files are authored locally and are **never** in
`https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/content-manifest.json`,
so `manifestSet.has(relPath)` is false for every one of them.

## Trigger

`ensureContent` prunes whenever it gets past the cache short-circuit — i.e. whenever the
manifest's single `contentHash` differs from the cached one
(`content-download.service.ts:187-198`). That is one hash for the entire manifest, so **any**
upstream plugin or template change anywhere fires a full prune. This is not a rare path; it
is the normal update path.

## Expected blast radius (predicted, not yet observed)

- Every file under every `ptah-harness-*` directory is unlinked.
- `unlinkSync` removes files only, so the directories survive empty. The plugin therefore
  still appears in the Configure modal — discovery is directory-based — but with a skill
  count of 0 and nothing to junction. It reads as "my skills silently vanished", not as an
  error.
- `disabledPluginIds` / `disabledSkillIds` entries in workspace state continue to reference
  the now-empty plugin, so the config is not self-healing.

## Reproduce first

Do this before writing any fix; a fix aimed at an unconfirmed mechanism is guesswork.

1. Author a skill through the harness wizard; confirm
   `~/.ptah/plugins/ptah-harness-<slug>/skills/<slug>/SKILL.md` exists.
2. Force a prune: edit `~/.ptah/.content-cache.json` so `contentHash` differs from the live
   manifest, then trigger content refresh.
3. Observe whether the authored `SKILL.md` survives.

## Fix directions (decide, don't default)

1. **Scope the prune to manifest-owned subtrees.** Prune only the plugin directories the
   manifest lists, rather than the plugins root. Narrowest change, keeps stale-file cleanup
   working for bundled plugins.
2. **Exclude `ptah-harness-*` explicitly** in `pruneStaleFiles`. Smallest diff, but it
   encodes a naming convention into a service that otherwise knows nothing about harnesses,
   and misses any other local content that lands there later.
3. **Move user-authored plugins out of `~/.ptah/plugins/`.** Cleanest separation — remote
   mirror vs. local authoring — and the largest change: discovery, the modal, junction
   building and any existing user profile would all need migrating.

Option 1 or 2 is a bugfix; option 3 is a small migration and should not be smuggled in
under this task without saying so.

## Test gap

`content-download.service.spec.ts` has no coverage for `pruneStaleFiles` interacting with
local content. Whatever fix lands needs a test that puts an unmanifested file in the
plugins tree and asserts it survives a prune.

## Related

- TASK_2026_258 — the docs task that surfaced this. `plugins/plugin-storage.md` and
  `plugins/harness-plugins.md` describe pruning as it exists today; if this defect is
  fixed, both need a follow-up edit.
