# A0 account spike: named-account route and synced-skill collision

Evidence only. No production source, settings, accounts or installed skills were changed.
Fixture: `evidence/a0-account/spike-account.mjs`. Data: `evidence/a0-account/sanitized-results.json`.

## Verdicts

| Item | Verdict |
| --- | --- |
| (1) Named-account startup and streamed first turn with Ptah options plus an unknown qualified override key | **PASS** |
| (2b) A qualified `anthropic-skills:<name>: off` hides only the synced skill and keeps the same-name workspace skill | **PASS** |
| (2c) Bare `docs: off` | **Observed: hides BOTH** the workspace `docs` and the synced `anthropic-skills:docs` |

## Environment

- Agent SDK 0.3.278, runtime executable 2.1.312, from `/home/amun/ptah-extension/node_modules`.
- Default Claude subscription route. The fixture removed every `ANTHROPIC_*` variable (including `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, which the parent shell had set), every `*_proxy` variable, every `CLAUDE_CODE_*` variable, and `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_AGENT_SDK_VERSION`, `CLAUDE_CONFIG_DIR` and `CLAUDE_EFFORT`. `HOME=/home/amun`, so the runtime used the real `/home/amun/.claude`. The init message reported `apiKeySource: "none"` in every case, which means the account login was used and no key was.
- Sandbox: `bwrap --ro-bind / /`, so `/home/amun/.claude` and `~/.claude.json` were read-only. The only writable paths were the case's own directory, a temp dir bound at `/tmp` (`TMPDIR=/tmp`) and a temp dir bound over `/home/amun/.claude/projects`. That last bind exists only inside the sandbox. It caught the runtime transcript so the fixture could read the first-turn `skill_listing` attachment. The real `projects/` directory got no A0 files (checked afterwards). Startup did not fail and no write-denied diagnostic was seen on stderr, so the runtime did not need write access to the config directory for these runs.
- `persistSession: true` was used only so that a transcript existed, and it was written to the sandbox temp mount. This departs from the brief's `persistSession: false`, because with that setting the system-reminder listing cannot be captured.
- Options matched Ptah's non-proxy path. `settingSources: ['user','project','local']` comes from `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1431-1435`. The other options were `tools` preset `claude_code`, `includePartialMessages: true`, `maxTurns: 1` and the prompt "Reply OK". `canUseTool` allowed only `Agent`. `disableClaudeAiConnectors` was not set because Ptah's builder does not set it.
- Credentials were never read. Only skill names were exported, plus answers that are the literal "OK" or a length placeholder.
- Cost: 6 model calls in total (4 cases, then a rerun of b and c, see below), `total_cost_usd` about 1.02. Both runs used `node scripts/verify.mjs --exec --task a0-account-spike` and exited 0. The raw workspaces and transcripts were deleted (`raw removed: true`).

## (1) Named-account streaming: PASS

Case `named-stream` used `skillOverrides: {'anthropic-skills:a0-nonexistent-897f': 'off'}` and had no project skill.
- Startup succeeded with no `startup_failure` event. Init reported model `claude-opus-5-5`.
- Streaming worked: 1 `message_start` and text deltas arrived as `stream_event`. The assistant replied `OK` with model `claude-opus-5-5`. The result was `success`, `is_error: false`, `num_turns: 1`.
- The unknown qualified key was accepted silently. All 13 synced `anthropic-skills:*` skills were still listed.

## (2) Synced-skill collision

The workspace held `.claude/skills/docs/SKILL.md` (name `docs`, description "A0 workspace docs probe"). The account syncs 13 skills, which appear as `anthropic-skills:<name>`: built-in-browser, chrome-browser, computer-use, deep-research, docs, docx, google-workspace, import-memory, morning, pdf, pptx, skill-creator, xlsx.

Below, "init" is the init message's `skills` field and "listing" is the first-turn `skill_listing` system-reminder attachment from the transcript. Only the names that matter here are shown. The rest of each list did not change between cases.

| Case | Overrides | init: docs / pdf entries | listing: docs / pdf entries | Synced entries in listing | init / listing totals |
| --- | --- | --- | --- | --- | --- |
| a. baseline | none | `docs`, `anthropic-skills:docs`, `anthropic-skills:pdf` | `docs`, `anthropic-skills:docs`, `anthropic-skills:pdf` (inferred, see note) | 13 | 59 / 61 |
| b. qualified off | `anthropic-skills:docs`, `anthropic-skills:pdf` → off | `docs` | `docs` | 11 (docs and pdf gone) | 57 / 59 |
| c. bare off | `docs` → off | `anthropic-skills:pdf` | `anthropic-skills:pdf` | 12 (docs gone) | 57 / 59 |

- **(b) PASS.** Removed compared with baseline: exactly `anthropic-skills:docs` and `anthropic-skills:pdf`, in both init and listing. The workspace `docs` stayed in both. Nothing else changed.
- **(c) Both are hidden.** Removed compared with baseline: the workspace `docs` and `anthropic-skills:docs`, in both init and listing. The synced `anthropic-skills:pdf` stayed. A bare key matches the short name across every source, so it is not a safe way to hide only one of two skills that share a name.

Note on the listing column. In the first run the fixture's name regex cut qualified names at their first colon, so the qualified listing entries were recorded only as `anthropic-skills`. Counted per case, those entries gave a: 13, b: 11, c: 12. The fixed regex is now in the fixture. Cases b and c were rerun with it (stored under `rerun` in `sanitized-results.json`) and give the exact qualified listing names shown above. Case a was not rerun, to stay within the 6-call budget. Its exact qualified listing is inferred from the count (13) together with its init list, which holds the 13 qualified names.

## Side observations

- init and the listing are not the same set. Some user-invocable commands and built-in skills appear in only one of them. For example `deep-research`, `design`, `verify` and `debug` are in init only, and `keybindings-help`, `init`, `security-review` and the project slash commands are in the listing only. The listing is what the model sees on its first turn.
- `named-stream` had 58 init skills and baseline had 59. The difference is the workspace `docs` probe, which only the collision workspace contains.

## Decisions

- Capture the system-reminder listing by turning on `persistSession` and binding a sandbox-only temp dir over `projects/`. The other option was init `skills` only with `persistSession: false`. The listing is the model-facing surface and the brief asks for it. The real config directory stayed read-only. This choice can be reversed.
- Rerun only cases b and c to get exact names. The other option was rerunning all four, which goes over the ≤6-call cap. This choice can be reversed.
