# TASK_2026_276 — ship the Python profile

The registry work is done; this is the content half.

## What already exists

- `python` profile in `libs/shared/src/lib/constants/stack-profiles.ts` —
  detection (`pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`,
  `Pipfile`, `uv.lock`, `poetry.lock`), source extension `.py`, toolchain probe.
- `FrameworkDetectorService` can now reach `Framework.Flask` / `Framework.FastAPI`
  from `pyproject.toml` — they were declared but unreachable before TASK_2026_270.
- Python already has a tree-sitter grammar in the AST layer, so symbol indexing
  works today.
- The intake's platform step already offers Python. Selecting it yields a profile
  whose skills are not installed; the handler names them and tells the agent to
  carry on with what it has.

## What to build

1. `ptah-python` plugin, roughly three skills mirroring the .NET split:
   `python-workspace-initializer` (Stage A, mandatory AskUserQuestion discovery),
   `python-workspace-architect` (src layout, package boundaries, dependency
   groups), and a workspace-tooling skill covering the Nx decision.
2. Fill in `requiredPlugins` on the profile.
3. Register per the checklist in TASK_2026_270's context: `.claude-plugin/plugin.json`,
   `AVAILABLE_PLUGINS`, `npm run manifest:generate` + `manifest:check`, mirrors.

## The open decision

Nx has no first-party Python plugin. `@nxlv/python` (community, uv/Poetry, part
of `lucasvieirasilva/nx-plugins`) is roughly what `@nx-dotnet/core` was before
`@nx/dotnet` shipped — usable, but community-maintained, and that comparison did
not end well. The honest default is probably plain uv with no Nx layer for a
single service, and `@nxlv/python` only when the user wants one workspace
spanning Python and TypeScript. Decide it explicitly rather than by omission.

## Consider consuming rather than authoring

The .NET path deliberately writes only glue and defers execution mechanics to the
.NET team's own marketplace plugins, because those are maintained daily by the
people who own the tooling. Check whether an equivalent well-maintained Python
skill marketplace exists before authoring skills we would then have to keep
current — the external-marketplace machinery from TASK_2026_270 makes consuming
one cheap, and `skills.sh` is already wired into `searchSkills`.

## Decisions taken (user, 2026-08-18)

Both answered at Checkpoint 1.5, after `research-report.md`.

1. **Consume `astral`.** `requiredPlugins` becomes
   `['ptah-python', { marketplace: 'astral-sh/claude-code-plugins', plugin: 'astral' }]`.
   Same division of labour as .NET: Ptah owns discovery, layout and the workspace
   decision; Astral owns uv/ruff/ty mechanics. Accepted cost — the repo is
   9 commits and last pushed 2026-02-27 (~5.5 months stale at time of decision).
   All three glue skills are authored regardless; nothing found does Python
   discovery/scaffolding the way `dotnet-template-engine` does for .NET.

2. **`monorepoDecision: 'ask'`, `nxPlugins: ['@nxlv/python']`** — _diverges from
   the research recommendation_, which was to keep `'given'`. The user's call:
   now that `@nxlv/python` is evidenced healthy (MIT, pushed 2026-07-28,
   264,774 weekly downloads, peer-compatible with Nx 22.6.5), Python gets the
   same explicit Nx question .NET gets rather than having it decided by omission.
   Consequences: the profile comment at `stack-profiles.ts:141-149` is now wrong
   twice over and must be rewritten; the workspace-tooling skill is a real
   decision skill, not documentation; and `'ask'` must route through whatever
   downstream machinery already serves `DOTNET_PROFILE`.

## Registration surface (verified 2026-08-18)

Four sites, not the four mirrors this task's notes imply — the "four parallel
marketplace manifests" in TASK_2026_270's context describe `dotnet/skills`' own
repo layout, not Ptah's. Ptah has one plugin tree.

1. `apps/ptah-extension-vscode/assets/plugins/ptah-python/` — mirror the shipped
   `ptah-dotnet` shape (`.claude-plugin/plugin.json` + `skills/<name>/SKILL.md`
   - `references/`; 5 files, ~620 lines total).
2. `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:58`
   `AVAILABLE_PLUGINS` — feeds `KNOWN_PLUGIN_IDS` at `:185`, a security allowlist
   that rejects any unlisted id.
3. `content-manifest.json` via `npm run manifest:generate`, verified by
   `npm run manifest:check`.
4. `libs/shared/src/lib/constants/stack-profiles.ts` `PYTHON_PROFILE`.
