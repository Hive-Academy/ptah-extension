# Context

## How this was found

Follow-on from the marketplace audit (TASK_2026_287). skills.sh is a first-class
provider tile in the Marketplace, alongside Plugins, MCP Registry and Smithery,
so the question was whether its installs get the same cross-CLI reach plugin
skills do. They did not.

`installSkillViaCli` shells `npx skills add`; `listInstalled` scanned exactly two
directories, `{ws}/.claude/skills` and `~/.claude/skills`, which is what gave the
destination away.

Two details sharpened it:

- The RPC already declared `agents?: string[]` on `skillsSh:install` and the
  handler destructured only `source`, `skillId`, `scope`. The wire contract had
  been designed for multi-agent targeting and the implementation dropped it.
- `scope: 'global'` wrote outside any workspace, where the workspace-scoped
  reconciler cannot see it at all.

## The fix: a source root, not a fourth writer

Content lands in `~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/skills/<slug>/`
with a `.ptah-skillssh.json` record. That is deliberately the `ptah-harness-*`
shape — a directory under `~/.ptah/plugins` holding a `skills/` tree is already a
first-class overlay source, so `resolveCurrentPluginPaths()` yields it,
`PluginConfigSourceResolver` hands it to the manifest builder as
`overlayPluginPaths`, and the skill becomes ordinary desired state: copied into
every detected target, hash-gated, manifest-owned, reaped when the root goes
away, and never `foreign` again. No new concept, no new manifest, no new writer.

**Overlay-only, deliberately NOT mirrored into `~/.ptah/user/skills`.** The user
layer is the BASE and wins every collision, and `UserLayerMirrorService` clones
create-if-absent — so a clone would SURVIVE uninstall. Deleting the source root
would leave the user-layer copy in the desired state and the skill would keep
propagating forever. Overlay-only is what makes `skillsSh:uninstall` actually
reap.

## The four decisions

**Staging, not reimplementation.** `npx skills@latest add --help` has
`-g/--global`, `-a/--agent`, `-s/--skill`, `-y`, `--copy` and **no
output-directory flag** — cwd is the only lever. Measured against a temp dir with
`HOME` redirected, an install produced exactly
`{cwd}/.claude/skills/<slug>/{SKILL.md,LICENSE.txt}` plus `{cwd}/skills-lock.json`,
exit 0, and **zero writes under `$HOME`**. That negative is the load-bearing one:
`-y`'s scope auto-detect could plausibly have fallen back to global in a
non-project directory and written into the developer's real `~/.claude`. It does
not. Those observations are pinned as executable assertions rather than left in
a comment.

**Legacy adoption is lockfile-driven, not heuristic.** Skills carry no writer
signature and never will (harness-sync CLAUDE.md, "Legacy adoption"), so content
cannot distinguish a Ptah install from a hand-written skill. `{ws}/skills-lock.json`
can: it is the third-party CLI's OWN record, which that CLI reads back itself.
That is evidence of ownership, the same class as the `.ptah-managed.json` files
this repo already adopts from — not an inference about content. A slug the
lockfile does not name is never touched, and a hand-written neighbour surviving a
sweep that adopts its sibling is a test. `~/.claude/skills` is deliberately NOT
adopted: no home-level lockfile exists, so nothing there can be told from a skill
the user installed outside Ptah.

**`agents?: string[]` deleted, not wired.** It was declared, Zod-validated and
dropped on the floor — every install hardcoded `--agent claude-code`. Wiring it
would have made target selection a second owner competing with the reconciler,
which fans out to every CLI the detector finds and would silently overwrite an
"install for Codex only" on the next pass.

**`scope` collapsed to `global`.** It is the only value the model can express:
desired state is `~/.ptah/user` plus `~/.ptah/plugins/*`, both user-global by
construction. Per-workspace control moved to `disabledPluginIds` /
`disabledSkillIds`, which is reversible in a way an install-time flag is not.
Narrowing `InstalledSkill.scope` to the literal turned a leftover
`scope === 'project'` filter into a compile error rather than an invisible dead
section — the browser had been rendering a "Project Skills" list that could never
populate.

## The security half

Making these values into directory names changed what the guards had to do.

`SAFE_SOURCE_PATTERN` is `/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/`, and `..` matches
`[a-zA-Z0-9_.-]+` — so the pattern **accepts the literal `../..`**.
`SAFE_SKILL_ID_PATTERN` accepts `..`. Harmless while these were only argv;
not harmless as path segments.

`isSafePathToken` / `parseSourceSlug` (in `shared`) is the half that rejects
them, and it always did. What was missing is that the RPC boundary ran **no
schema at all** on install — the outermost of three layers was open. It now
validates and then calls the shared guard rather than restating the rule, and
uninstall adds `isSafePathToken` on top of its regex. All three layers are tested
against `../..`, `../../../../etc/passwd`, `/etc/passwd`, backslash separators,
`;` `|` `$()` newline injection, and flag-shaped sources.

Command injection was never reachable despite `spawn(..., { shell: true })`: the
allowlist admits only `[a-zA-Z0-9_.-]` and `/`, so no shell metacharacter
survives.

## Where it lives

- `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts`
- `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.ts`
- `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-legacy-adoption.ts`
- `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts` (staging)
- `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts`

## Note for the next person

`nx lint <project>` does not run `tools/di-lint`, which is its own Nx project.
An `@inject` of a token no `register*.ts` registers is a silent runtime crash,
and only the repo-wide lint catches it. This task shipped one such token before
the pre-commit gate rejected it; the seam is now a plain defaulted constructor
parameter with a comment explaining why it must not become a token again.
