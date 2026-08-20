# TASK_2026_279 — Harness provenance marker

Follow-up to TASK_2026_278 (harness reconciler). Filed from that task's own smoke test.

## The gap

The reconciler owns an entry only if its manifest (`{ws}/.ptah/harness/<target>.manifest.json`) names it. Anything else at a desired path is `foreign`: left alone, and — since TASK_2026_278's "one classification" fix — also counted `missing`, because the desired artifact genuinely is not there.

For rival-CLI **agents** that is recoverable: `IHarnessAgentTransformer.isPtahOutput(content)` recognises Ptah's own output by signature, so 21 orphaned codex/copilot agent files were adopted on this workspace. For **skills and commands** there is no signature, so:

- every copy the deleted `SkillJunctionService` wrote before the manifest existed is foreign forever;
- `ptah harness doctor --fix` cannot make the workspace green, and the user's only remedy is to delete files by hand from a list;
- an upgrading user's first doctor run reports drift that is really just their own history.

Verified end state on the dev workspace after `--fix`:

```
claude   expected 26  found 24  missing 2  foreign 8
  missing: .claude/skills/ptah-cli-usage, .claude/commands/orchestrate.md
```

Both are stale Ptah output. The reconciler cannot know that.

## Scope

1. **Marker.** Decide the carrier per artifact kind and write it on every copy:
   - commands / skills `SKILL.md`: a frontmatter key (`ptah_source: <sourceId>` or reuse the `source: ptah` convention the agent transformers already use) — must survive the file being read by Claude/Cursor as a normal skill, so it has to be valid frontmatter, not a comment.
   - non-markdown files inside a skill dir (references, scripts, assets): no in-file marker is possible — rely on the directory's `SKILL.md` marker plus the manifest.
2. **Adoption.** `planEntry` in `claude-target.ts` / `workspace-target.ts`: unowned entry whose marker says Ptah → adopt, overwrite with current output, record in `adopted[]`. No marker → stays `foreign` + `missing`, as today.
3. **One-time legacy sweep.** Copies written before the marker existed have no marker either. Decide and document one of: (a) adopt an unowned entry whose content hash equals _any_ known source's current or historical hash; (b) adopt on first run after upgrade if the entry matches a slug the user layer owns AND the workspace has no pre-existing manifest (fresh migration signal); (c) ship a `ptah harness adopt <path>` verb and have `doctor` suggest it. Prefer (c) plus (a) — never a blanket "assume ours".
4. **Deep verify.** `HarnessPreflightService` compares desired hashes to the manifest and stats owned paths; it never re-hashes target dirs, so a hand-edited managed copy is invisible until the next `mode:'full'` pass (documented blind spot in `harness-sync/CLAUDE.md`). Add `mode:'verify'` (re-hash owned entries, no writes) used by `harness:health` and by `doctor` without `--fix`, and keep the cheap path for session start.

## Acceptance

- A stale Ptah-written skill/command is adopted and refreshed; a user-authored file at the same path is not, and `doctor` lists it with a one-line remedy.
- `ptah harness doctor --fix` reaches exit 0 on the dev workspace without hand-deleting files.
- Specs: marker written on copy; adoption on marker match; no adoption without marker; legacy sweep path; deep verify detects a hand-edited copy.
- `libs/backend/harness-sync/CLAUDE.md` updated (marker format, adoption rules, verify modes).
