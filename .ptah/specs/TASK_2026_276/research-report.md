# Research Report — TASK_2026_276: ship the Python profile

Verification note: this pass ran across two sessions — an initial one that hit a
total external-tool outage (`AbortError: Stream closed` on every `gh`/`curl`/
`WebFetch`/`WebSearch`/MCP call), and this resumed one, where the orchestrator
confirmed tools were live again and I re-verified every external claim from
scratch rather than carrying over anything unconfirmed. Every fact below has a
URL and a verification timestamp; nothing is inherited from the earlier
outage draft. Today is 2026-08-18.

## Decision table

| Question                          | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Confidence  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Q1** Consume or author?         | **(c) Partial.** Author all three glue skills — nothing found does Python discovery/scaffolding the way `dotnet-template-engine` does for .NET. Add `astral-sh/claude-code-plugins`' single `astral` plugin to `requiredPlugins` for uv/ruff/ty tool mechanics (narrow, tool-usage analogue of `dotnet-msbuild`/`dotnet-nuget` — not of the initializer/architect skills). `anthropics/skills` ruled out with evidence (no Python content). `anthropics/claude-plugins-official` (255-plugin aggregator) not exhaustively enumerated — no Python-workspace hit found in what was checked. `skills.sh` has individual FastAPI knowledge skills, not a marketplace-shaped scaffolding plugin.          | High        |
| **Q2** `@nxlv/python` vs plain uv | Keep `monorepoTool: 'none'` / `monorepoDecision: 'given'` as already coded — but revise the _reasoning_ in the code comment. `@nxlv/python` is actively maintained (pushed 3 weeks ago, 264,774 weekly npm downloads, MIT, peer-compatible with this repo's Nx 22.6.5) — it is **not** an `@nx-dotnet/core`-style abandonware story. The reason to keep `given` is that no **official**, `@nx`-scoped Python package exists at all (unlike .NET's official-but-experimental `@nx/dotnet`), not that nothing usable exists. Document `@nxlv/python` by name, with real numbers, as an option inside the workspace-tooling skill rather than surfacing it as an equal-footing Stage-A intake question. | High        |
| **Q3** What skills must cover     | Author: src-layout vs flat-layout, `pyproject.toml` + PEP 735 dependency groups, uv-first workflow (Poetry as a named alternative), ruff/mypy wiring, pytest layout, FastAPI/Django/Flask shape selection, and `@nxlv/python` as a named, evidenced Nx option. Flag PEP 735 tool-support specifics and uv's fastest-moving feature surface as things to verify live rather than hardcode.                                                                                                                                                                                                                                                                                                            | Medium-high |

---

## Q1 — Consume or author?

### `astral-sh/claude-code-plugins` — the strongest candidate

**Repo metadata** — verified 2026-08-18, `gh api repos/astral-sh/claude-code-plugins`:
`stars: 299`, `license: Apache-2.0` (repo ships both `LICENSE-APACHE` and `LICENSE-MIT`,
dual-licensed per its README — GitHub's detected SPDX id just reports one), `archived: false`,
`open_issues: 13`, `pushed_at: 2026-02-27T16:09:15Z` — **~5.5 months stale as of today**.
Total commit count (`gh api .../commits`): **9**. That is a materially weaker maintenance
signal than `dotnet/skills`' 5,173 stars and daily-push cadence recorded in TASK_2026_270.

**Marketplace manifest** — verified 2026-08-18, fetched
`https://raw.githubusercontent.com/astral-sh/claude-code-plugins/main/.claude-plugin/marketplace.json`
directly:

```json
{
  "name": "astral-sh",
  "owner": { "name": "Astral", "url": "https://astral.sh" },
  "plugins": [
    {
      "name": "astral",
      "source": "./plugins/astral",
      "description": "Skills for working with Python using Astral tools."
    }
  ]
}
```

One marketplace, one plugin. The correct `PluginRef` is
`{ marketplace: 'astral-sh/claude-code-plugins', plugin: 'astral' }` — confirmed against
the manifest, not reconstructed from the README.

**Contents** — verified 2026-08-18, `gh api repos/astral-sh/claude-code-plugins/contents/plugins/astral/skills`:
three skills, `ruff/`, `ty/`, `uv/`. No `.claude-plugin`-adjacent MCP config found:
a GitHub code search for `filename:.mcp.json repo:astral-sh/claude-code-plugins` returned
zero results. The README's mention of a `ty` LSP is invoked directly via `uvx` at skill-run
time, not declared as a bundled MCP server in this repo — the consent surface is "runs
`uvx`/`ruff`/`ty` as external processes," not "installs an MCP server," which is a lighter
footprint than `dotnet-msbuild`'s bundled MCP server.

**Scope**: these are tool-_usage_ skills (how to invoke uv/ruff/ty correctly), published by
the vendor org itself (astral.sh, the same org that ships uv/ruff/ty) — legitimate and
trustworthy for what it is, comparable in spirit to `dotnet-msbuild`/`dotnet-nuget`. It does
**not** do discovery, does not use `AskUserQuestion`, does not scaffold a project, and does
not decide src-layout/dependency-groups/framework shape. It is complementary to, not a
substitute for, `python-workspace-initializer`/`python-workspace-architect`.

### `anthropics/skills` — ruled out

Verified 2026-08-18 by reading the manifest content directly
(`github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json`):
marketplace name `anthropic-agent-skills`, owned by an individual contributor
(`Keith Lazuka <klazuka@anthropic.com>`) rather than an institutional CODEOWNERS process
the way `dotnet/skills` is. Two plugins: `example-skills` (algorithmic-art,
brand-guidelines, canvas-design, doc-coauthoring, frontend-design, internal-comms,
mcp-builder, ...) and `document-skills` (xlsx, docx, pptx, pdf). **Zero Python-workspace
content.** Cleanly ruled out — not a candidate.

### `anthropics/claude-plugins-official` — found, not exhaustively checked

New finding this pass, not in the original candidate list: a **separate**, larger
Anthropic-curated aggregator marketplace. Verified 2026-08-18 via its GitHub about page:
33.4k stars, Apache-2.0, "Official, Anthropic-managed directory of high quality Claude Code
Plugins," 255 plugins per a third-party mirror (`aitmpl.com`, **unverified secondary
source, treat as directional only**). Its entries can point at external repos via
`source: { source: "git-subdir" | "url", ... }`. Search surfaced third-party integration
skills inside it (Zoho Catalyst, Azure SQL, Cloudflare, Cloudinary, Runway API's
FastAPI/Flask/Django _code-generation-for-Runway_ skills — not general Python workspace
scaffolding). **Not exhaustively enumerated** — 255 entries were not individually fetched.
No Python-workspace-initializer-shaped plugin was found in what was checked, but absence
here is a research gap, not a confirmed negative. Worth a dedicated pass if this task is
revisited.

### `skills.sh` — individual skills, different install mechanism

Verified 2026-08-18: found `mindrally/skills/fastapi-python` on skills.sh — "Expert
guidance for building high-performance FastAPI APIs with async best practices and clean
Python patterns." This is a single knowledge-style `SKILL.md` (FastAPI conventions,
Pydantic v2, RORO pattern), not a discovery/scaffolding flow, and skills.sh installs
individual skills via `npx skills add <owner/repo>` — a different mechanism from the
`.claude-plugin/marketplace.json` + `requiredPlugins` path this profile uses. Even if
useful as background knowledge, it doesn't reduce the scope of
`python-workspace-architect`'s framework-shape section, and it isn't wireable through
`requiredPlugins` the way `astral-sh/claude-code-plugins` is.

### Verdict

**(c) partial**, unchanged from the pre-outage draft but now fully evidenced: author
`python-workspace-initializer`, `python-workspace-architect`, and the workspace-tooling
skill; add `{ marketplace: 'astral-sh/claude-code-plugins', plugin: 'astral' }` to
`PYTHON_PROFILE.requiredPlugins` alongside `'ptah-python'`. Flag the astral repo's
5.5-month-stale push date plainly wherever it's named in skill content, the way
`nx-dotnet-workspace` plainly flags `@nx/dotnet`'s experimental status — this is a real,
if minor, risk difference from `dotnet/skills`' daily cadence.

---

## Q2 — The workspace-tooling decision

**`lucasvieirasilva/nx-plugins`** (home of `@nxlv/python`) — verified 2026-08-18,
`gh api repos/lucasvieirasilva/nx-plugins`: `stars: 150`, `license: MIT`,
`archived: false`, `open_issues: 19`, `pushed_at: 2026-07-28T17:06:35Z` — **~3 weeks
before today**.

**`@nxlv/python` package** — verified 2026-08-18 via `registry.npmjs.org/@nxlv/python/latest`
and npmjs.com: version `23.0.0`, license `MIT`, weekly downloads **264,774**, last publish
~15 days before the check (consistent with the repo's 2026-07-28 push).
`peerDependencies: { "@nx/devkit": ">=22.0.0" }` — **no upper bound**, so it is
peer-compatible with this repo's Nx 22.6.5. Single maintainer (`lucas.vieira`) — real
bus-factor risk, but the download/star/issue/push cadence is that of an actively used,
actively maintained package, not an abandoned one.

**uv support, not just Poetry**: verified 2026-08-18 from the npm README excerpt — the
package documents a Poetry→uv migration path, a `uv-project` generator
(`npx nx generate @nxlv/python:uv-project`), and a `run-commands` executor pattern that
runs `uv run pytest` directly. It is not Poetry-only; the task's framing of it as
"uv/Poetry" was correct, and this is now confirmed rather than assumed.

### Comparison to `@nx-dotnet/core`

TASK*2026_270's research on `@nx-dotnet/core` (archived, deprecated, superseded by the
official `@nx/dotnet`) does **not** describe `@nxlv/python`'s current state. The correct
comparison point is different: .NET has both an official `@nx`-scoped package
(`@nx/dotnet`, experimental) \_and* a now-dead community predecessor. Python has **no**
official `@nx`-scoped package at all — only the actively-maintained third-party
`@nxlv/python`. So the choice for Python isn't "official-experimental vs.
dead-community-package," it's "no official path vs. one healthy third-party path." That
is a narrower, more defensible gap than the .NET one, but it is still a gap: recommending
`@nxlv/python` with the same weight as `@nx/dotnet` would misrepresent its standing as an
Nx-org product, regardless of how well it's currently maintained.

### Verdict

**Keep `monorepoTool: 'none'` / `monorepoDecision: 'given'`.** The existing code comment
in `stack-profiles.ts:174-178` ("with no first-party Nx plugin, uv workspaces are the only
honest answer") is directionally right but should be revised to stop implying `@nxlv/python`
isn't worth using — it clearly is, for the specific case of a genuinely mixed Python+TypeScript
Nx workspace. The corrected reasoning: Ptah's Stage-A intake question exists to ask about
_official_ tooling forks (as it does for .NET); a well-maintained but still third-party
Nx wrapper belongs as a documented, named, evidenced option inside the workspace-tooling
skill — same shape as `nx-dotnet-workspace` documents `@nx/dotnet`'s experimental caveats —
not as an equal-weight Stage-A default. Re-check `@nxlv/python`'s numbers at authoring
time; they were healthy today but this is a single-maintainer project and that can change.

---

## Q3 — What the Python skills must actually cover

### `python-workspace-initializer` (Stage A, mirrors `dotnet-solution-initializer`)

- Round 1 business discovery: reuse verbatim from `saas-workspace-initializer`, same as
  the .NET skill does.
- Round 2 Python-specific: package manager (uv / Poetry / Recommend for me → uv, matching
  `PYTHON_PROFILE.scaffoldCommands: ['uv init']`), project shape (FastAPI / Django / Flask
  / library / Recommend for me — mirrors the `stackOptions` already in the profile),
  src-layout vs flat-layout, dependency groups (dev/test/lint minimum, PEP 735), test
  framework (pytest is the de facto default — the honest question is whether the user
  wants anything else at all), and the Nx-or-not question **as an in-skill documented
  option inside the workspace-tooling skill, not a Stage-A `AskUserQuestion`** per the Q2
  verdict.
- Handoff boundary: name `astral-sh/claude-code-plugins`' `astral` plugin explicitly for
  "run uv/ruff/ty correctly," the way the .NET initializer names `dotnet-template-engine`/
  `dotnet-test` — don't re-teach uv/ruff CLI mechanics here. Note its 2026-02-27 last-push
  date in the skill text so the agent (and user) can judge freshness at read time rather
  than trusting a silently-aging claim.

### `python-workspace-architect`

- src-layout (`src/<package>/`) vs flat-layout as an explicit decision table (mirrors
  `dotnet-solution-architect`'s Clean-Architecture-vs-vertical-slices table) — src-layout
  is the safer default for anything meant to be installed/imported cleanly; flat layout
  is legitimate for a single-script/simple-service project.
- `pyproject.toml` shape: `[project]` table, PEP 735 `[dependency-groups]` as the modern
  replacement for `requirements-dev.txt` sprawl. **Flag as fast-moving**: PEP 735 itself is
  a settled spec, but which of uv/Poetry/pip fully support it, and how, is the part likely
  to have shifted by the time this skill is read — point at uv's own current docs
  (`docs.astral.sh/uv/concepts/projects/dependencies`) rather than hardcoding syntax that
  can go stale.
- Package boundaries for a multi-module Python workspace: uv's native
  `[tool.uv.workspace]` members mechanism (confirmed current as of
  `docs.astral.sh/uv/concepts/projects/workspaces`, checked 2026-08-18) for the case where
  uv alone is chosen without Nx; `@nxlv/python`'s generators for the case where Nx was
  chosen. Most Python services are single-package, so this is far less load-bearing than
  the .NET architect's `ProjectReference` rules.
- ruff (lint + format, now the standard replacement for flake8+black+isort) and mypy (or
  the project's chosen checker) — name the tools and where their config sections live in
  `pyproject.toml`; defer rule-level detail to the astral plugin.
- Framework shape: Django (has its own opinionated scaffolding via `django-admin
startproject`/`startapp` — hand off to that rather than reinventing it); FastAPI and
  Flask (neither has official scaffolding — this skill's src-layout + dependency-groups
  guidance _is_ the opinion for both).

### Workspace-tooling skill (the Nx decision, mirrors `nx-dotnet-workspace`)

- States plainly, with the verified numbers above: no official Nx Python plugin exists;
  `@nxlv/python` (150 stars, MIT, pushed 2026-07-28, 264,774 weekly npm downloads,
  peer-compatible with Nx `>=22.0.0`, single maintainer) is a real, actively-maintained,
  but still third-party option — not an `@nx-dotnet/core`-style dead end, and not an
  `@nx/dotnet`-style official one either.
- Default recommendation: plain uv (`uv init`, `uv add`, `uv sync`, native workspace
  support), no Nx layer, for the common single-service/single-package case.
- Document `@nxlv/python` as the named option for a workspace genuinely combining Python
  and TypeScript under one Nx graph, with an instruction to re-check its npm page for
  current numbers before recommending it rather than embedding today's figures as
  permanent fact — this report's own Q2 section is the cautionary example of how fast
  "unverified" can flip to "verified and different from assumed."

### Explicit churn-risk flags (author defensively, don't hardcode)

- PEP 735 dependency-groups tool-support matrix — point at live docs, don't hardcode a
  support table.
- uv's workspace/lockfile feature surface — ships fast; keep guidance at the
  `uv init`/`uv add`/`uv sync` level and point to `uv --help`/current docs for specifics.
- `@nxlv/python`'s maintenance status — re-verify before every major skill revision.

---

## Registration checklist (unchanged, not re-researched — already specified in

TASK_2026_270's and this task's context.md)

Create `apps/ptah-extension-vscode/assets/plugins/ptah-python/` mirroring the 5-file,
~620-line `ptah-dotnet` shape (`.claude-plugin/plugin.json` + 3×`SKILL.md` + reference
docs as needed); add to `AVAILABLE_PLUGINS` in
`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:58`; run
`npm run manifest:generate` + `manifest:check`; fill
`PYTHON_PROFILE.requiredPlugins` in `libs/shared/src/lib/constants/stack-profiles.ts:187`
(currently `[]`) with `'ptah-python'` plus
`{ marketplace: 'astral-sh/claude-code-plugins', plugin: 'astral' }`.
