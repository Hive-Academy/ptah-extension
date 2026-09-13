# Batch 7 report — TASK_2026_402_a5c7 (Component 11)

Worktree `D:\projects\ptah-extension\.claude-worktrees\agent-messaging`, branch
`feat/agent-two-way-messaging`, on top of `213dcdc13`. Nothing committed, no
stash, no checkout, no `nx reset`, no edit to `batches.md`.

Status: **BATCH_7_DONE**. Tasks 7.1 – 7.3 done. This batch is transcription
against what Batches 4/5/6 actually shipped, re-read on disk rather than taken
from the plan's prediction.

---

## Files modified (15)

- `libs\backend\rpc-handlers\src\lib\harness\config\builtin-presets.ts` — Task 7.1
- `libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts` — Task 7.2 (R-3)
- `.claude\skills\ptah-cli-usage\references\agent-cli.md`
- `.claude\skills\ptah-cli-usage\references\internal-mcp.md`
- `.claude\skills\ptah-cli-usage\references\mcp-serve.md`
- `apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-cli-usage\references\agent-cli.md` (byte-identical to its `.claude/skills` twin)
- `apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-cli-usage\references\internal-mcp.md` (byte-identical)
- `apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-cli-usage\references\mcp-serve.md` (byte-identical)
- `apps\ptah-docs\src\content\docs\agents\cli-agents.md`
- `apps\ptah-docs\src\content\docs\mcp-and-skills\ptah-tools.md`
- `apps\ptah-docs\src\content\docs\mcp-and-skills\driving-ptah-via-mcp.md`
- `apps\ptah-cli\docs\jsonrpc-schema.md`
- `libs\backend\cli-agent-runtime\CLAUDE.md`
- `libs\backend\agent-sdk\CLAUDE.md`
- `libs\backend\vscode-lm-tools\CLAUDE.md`

`apps\ptah-extension-vscode\assets\harnesses\tribunal-conductor.json` was
**verified, not re-edited** — it already carries `ptah_agent_message` and
`ptah_agent_report` in its `enabledTools.ptah` allow-list and no
`ptah_agent_steer`, per the "Already fixed" note batches.md added on
2026-09-12. A grep of `assets\harnesses\` for `ptah_agent` finds only this
file, and it is clean.

## Task 7.1 — the preset allow-list

`builtin-presets.ts`'s `enabledTools.ptah` (the Tribunal Conductor preset)
replaced `'ptah_agent_steer'` with `'ptah_agent_message'` and added
`'ptah_agent_report'`, in that position, so the preset's tool grid still
reads spawn → status → read → message → report → stop. No dedicated
`builtin-presets.spec.ts` (or any other spec under
`libs/backend/rpc-handlers/src/lib/harness/config/`) references
`ptah_agent_*`, so there was no spec to update.

## Task 7.2 — total rename

`ptah-system-prompt.constant.ts:228` (R-3, named nowhere in the plan) — the
one-line `ptah_agent_steer` table row became two rows for `ptah_agent_message`
and `ptah_agent_report`, each stating the four delivery modes / no-`agentId`
contract in the same terse style the rest of that table uses. This is
agent-facing prose baked into a `.ts` file; leaving it unrenamed would have
been the exact failure Component 11 exists to prevent — the retired tool name
surviving in the live system prompt.

**Repo-wide grep for `ptah_agent_steer` / `agent_steer`, outside
`.ptah/specs`, `.nx/cache` and `dist/`:**

```
grep -rn "ptah_agent_steer\|agent_steer" --include="*" -I . \
  | grep -v "\.ptah/specs" | grep -v node_modules \
  | grep -v "^\./\.nx/cache" | grep -v "^\./dist/"
```

Twelve hits, **all deliberate "the retired X" mentions**, the same class
Batch 5 already established as acceptable and pinned with its own assertion
(`protocol-dispatcher.spec.ts:1396`, `expect(names).not.toContain('ptah_agent_steer')`):

- 3 in this batch's own new prose (`agent-cli.md`, `internal-mcp.md`,
  `mcp-serve.md` under `.claude/skills`) explaining that `ptah_agent_message`
  replaced `ptah_agent_steer`
- the same 3, byte-identical, under the `assets/plugins` mirror
- 3 in `apps/ptah-docs` (this batch)
- 1 in `libs/backend/vscode-lm-tools/CLAUDE.md` (this batch)
- 1 pre-existing spec assertion (`protocol-dispatcher.spec.ts`)
- 3 pre-existing doc comments from Batch 5 explaining why the new schemas
  are `.strict()` (`protocol-dispatcher.ts`, `tool-description.builder.ts`,
  `agent-tool.dispatcher.ts`)

Zero hits treat `ptah_agent_steer` / `agent_steer` as a live, callable tool
anywhere outside `.ptah/specs` (historical record, untouched) and the build
caches (`dist/`, `.nx/cache/`, stale artifacts that regenerate on next
build).

## Task 7.3 — the guidance content

Written once as a vendor-neutral block and reused verbatim (via `cp`, so the
two skill copies stay byte-identical, which the harness-sync convention for
this skill relies on) across `.claude/skills/ptah-cli-usage/references/{agent-cli,internal-mcp,mcp-serve}.md`
and their `assets/plugins` mirror, then adapted per page for
`apps/ptah-docs` and `apps/ptah-cli/docs/jsonrpc-schema.md`. Every content
point batches.md dictated:

- **Peer discovery** — `ListAgents` / `SendMessage` reach only sessions
  started through Ptah's own agent SDK, never a CLI agent spawned via
  `ptah_agent_spawn`; use `ptah_agent_message` / `ptah_agent_report` for
  those. Phrased without naming the underlying vendor anywhere — see the
  marketplace note below.
- **Per-CLI capability** — every new passage points at `ptah_agent_list`
  (`messaging: steer|interrupt|queue|none`) and states explicitly that this
  is a runtime fact, never a fixed roster.
- **Waiting** — `notify_when_idle` documented with BOTH limits: only the
  main conversation may subscribe (a subagent that calls it gets the whole
  call refused), and it reaches sessions on this machine only. The rival-CLI
  equivalent, `ptah_agent_status` on a matched interval and never a tight
  loop, is stated alongside it every time.
- **Version floors** — recorded in `ptah-tools.md` (the docs site, where
  naming a version has no marketplace consequence): CLI 2.1.234 native
  Windows / 2.1.224 elsewhere for cross-session messaging, 2.1.224 for
  `crossSessionInbound`, 2.1.236 for `notify_when_idle`; pinned SDK 0.3.150,
  with `origin.fromMode` (SDK 0.3.234) named as out of reach and nothing
  depending on it.
- **Modes** — every mention of `interrupt-resume` states it discards the
  interrupted turn's partial work, immediately followed by "`steer` and
  `queue-next-turn` do not."
- **Completed-but-alive** — stated as intended ("its process is kept alive
  on purpose, not left running by accident"), not flagged as a leak.
- **R-9 (`crossSessionInbound: 'accept'`)** — stated plainly in
  `internal-mcp.md`'s new section: it covers only sessions Ptah itself
  starts, and a session Ptah did not start (a developer's own terminal
  session) keeps the default hold-then-expire behavior and needs its own
  `--settings`.

### R-10 — the marketplace constraint

Checked the shipped surface before writing anything into it:
`apps/ptah-extension-vscode/CLAUDE.md` confirms `assets/plugins/**` is
excluded from the VSIX by `.vscodeignore`, but batches.md's R-10 and Task
7.3 ask for the constraint to be honoured anyway (these files are still
published to GitHub and downloaded by `ContentDownloadService` at runtime),
so I treated it as binding.

Every new sentence added to `internal-mcp.md` / `agent-cli.md` / `mcp-serve.md`
(both the `.claude/skills` original and the `assets/plugins` mirror) is
phrased without `copilot|codex|claude|openai|anthropic` — "Ptah's own agent
SDK" instead of naming the vendor, "the underlying agent CLI" for the version
floor. Verified:

```
grep -inE "\b(copilot|codex|claude|openai|anthropic)\b" \
  apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/{agent-cli,internal-mcp,mcp-serve}.md
```

`internal-mcp.md` and `mcp-serve.md`: zero hits. `agent-cli.md`: 5 hits, all
**pre-existing** (lines 24, 36, 38, 43, 216 — the `--cli` selector table and
the `codex`/`copilot`/`Anthropic-compatible` prose), none of them touched or
added by this batch; my edits to that file (the header line and the "Where
spawn/status/.../message/report live" section) contain no vendor name.
Flagged below as an out-of-scope finding rather than fixed — see below.

## Task count corrections made while transcribing

Read the real tool lists rather than trusting the plan's arithmetic:

- Internal HTTP `agent` namespace: 6 → **7** tools (confirmed against
  `protocol-dispatcher.ts`'s `buildAgentSpawnTool` … `buildAgentListTool`
  calls at `:300-306`), so the always-on-plus-namespace total in
  `internal-mcp.md` moves 51 → **52**, and the non-IDE-host total moves
  48 → **49**.
- Stdio MVP tool tuple: 7 → **8** (confirmed against
  `MCP_MVP_TOOL_NAMES` in `tool-builders.ts:33-42` — Batch 5's report
  already flagged the plan's "9" as wrong; I re-verified independently and
  got the same 8). Updated every "7 tool" / "seven-tool" / "mvp:7" mention
  in `mcp-serve.md`, `driving-ptah-via-mcp.md` and `jsonrpc-schema.md`.

---

## Verification

Run from the worktree root. Full output read from files; no `| tail` masking
an exit code. `nx test ptah-cli` was **not attempted** — filed as
TASK_2026_427_f669, per the instruction not to work around it. `npx nx reset`
was never run.

```
npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools --parallel=1
  NX   Running target test for 2 projects
  vscode-lm-tools:  46 suites passed, 46 total
  rpc-handlers:     93 passed, 1 FAILED (skills-sh-source-root.service.spec.ts,
                     "writes every slug of a whole-repo install…", 5000ms jest
                     timeout — a file this batch never touches)
  exit 1
```

Re-run in isolation, serially, per the repo's own note that a `--runInBand`
retry on a quiet run distinguishes a flake from a regression:

```
npx nx test @ptah-extension/rpc-handlers --skip-nx-cache --runInBand
  Test Suites: 94 passed, 94 total
  Tests:       31 skipped, 2725 passed, 2756 total
  exit 0
```

94/94 green on retry, same shape as the flake class Batch 5's report already
named (5s jest timeouts on real filesystem/network work under worker
contention). `builtin-presets.ts` is not this suite's subject, and I did not
touch `skills-sh-source-root.service.spec.ts` or anything it imports.

```
npx nx run-many -t lint -p @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools --parallel=1
  rpc-handlers:      19 problems (0 errors, 19 warnings)
  vscode-lm-tools:   21 problems (0 errors, 21 warnings)
  NX   Successfully ran target lint for 2 projects
  exit 0
```

Both counts are **identical to Batch 5's own reported baseline** (19 and 21),
so this batch added no new warning to either project. No file this batch
created is warned; the two files this batch edited that also carry
`max-lines` warnings (`ptah-system-prompt.constant.ts` is not among the
warned files, `builtin-presets.ts` is not either) were already clean.

```
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools --parallel=1
  NX   Successfully ran target typecheck for 2 projects
  exit 0
```

### The batch's own acceptance checks

- Repo-wide grep for `ptah_agent_steer` / `agent_steer` → zero LIVE hits
  (twelve historical "replaced X" mentions, all outside `.ptah/specs`,
  `.nx/cache`, `dist/`). ✔
- Marketplace grep on the three `assets/plugins/**` reference files → zero
  hits in `internal-mcp.md` / `mcp-serve.md`; `agent-cli.md` carries 5
  **pre-existing** hits this batch did not introduce (see below). This
  batch's own additions to all three files are vendor-neutral.
- `vendor-roster-drift.spec.ts` green, unmodified — part of the 46 green
  suites in `vscode-lm-tools`. ✔

---

## Out-of-scope observations (found by this batch, owned by no batch)

1. **`agent-cli.md` (both the `.claude/skills` original and its
   `apps/ptah-extension-vscode/assets/plugins` mirror) already names
   `codex`, `copilot` and "Anthropic-compatible" before this batch touched
   it** — lines 24, 36, 38, 43, 216. Per `apps/ptah-extension-vscode/CLAUDE.md`,
   `assets/plugins/**` is excluded from the VSIX by `.vscodeignore`, so the
   Marketplace scanner never sees this specific copy — but the file is still
   published on GitHub and fetched at runtime by `ContentDownloadService`,
   and `auth-and-providers.md` in the same mirrored skill directory has the
   same issue (`Claude CLI subscription`, `claude-3-5-sonnet-20241022`,
   etc.). Pre-existing, out of Batch 7's file list, and large enough (a
   whole skill's worth of CLI-selector documentation) that I did not attempt
   a fix under this batch's scope. Worth its own task if the marketplace
   rule is meant to hold even for GitHub-fetched content, not just the VSIX.
2. **`apps/ptah-cli/src/cli/commands/mcp-serve.ts:372`** still has a literal
   `'mvp:7'` fallback string in its boot log
   (`` `[ptah-mcp] ready (tools=${...} || 'mvp:7'})` ``), now stale — the MVP
   set is 8. Not in Batch 5's or Batch 7's owned-files list (Batch 5 owns
   only `mcp-serve.spec.ts`, not `mcp-serve.ts` itself), so left unedited;
   flagging it here since it is the same class of drift this batch exists to
   catch, just in a file no batch claimed.
3. **`.nx/cache/**` and `dist/**` still contain compiled copies with
   `ptah_agent_steer`** (bundled `main.mjs`, cached `index.cjs` files, and a
   stale `tool-description.builder.d.ts`). These are build artifacts that
   regenerate on the next build; not source, not touched.

## Left undone

- Nothing in this batch's own scope. Batch 8 (empirical acceptance) is the
  next dependency and needs a live vendor + running product, which this
  batch cannot provide.
