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
