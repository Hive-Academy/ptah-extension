# Writer lane W2 — evidence report

Status: complete. Five pages written. Link check (`_linkcheck.mjs`): 0 bad links, 0 frontmatter issues.

Path prefixes: `MC` = `libs/frontend/memory-curator-ui/src/lib`, `ST` = `libs/frontend/chat/src/lib/settings`,
`CE` = `libs/backend/vscode-lm-tools/src/lib/code-execution`.

## apps/ptah-docs/src/content/docs/memory/timeline-and-corpus.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Memory tab is in Thoth | `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:376` |
| 2 | View tabs Memories, Timeline, Corpus, Code index, Maintenance | `MC/components/memory-curator-tab.component.ts:349-353` |
| 3 | Row shows type, captured time, score; subject, concepts, files when present | `MC/components/timeline-view.component.ts:95-124` |
| 4 | Search box placeholder "Filter timeline (BM25 + filters)..." | `MC/components/timeline-filters.component.ts:45` |
| 5 | Type chips Bugfix…Change, toggle on click | `MC/components/timeline-filters.component.ts:18-23`, `:76-89` |
| 6 | Concepts / Files comma-separated inputs | `MC/components/timeline-filters.component.ts:96`, `:104`, `:205-210` |
| 7 | From / To date range | `MC/components/timeline-filters.component.ts:113-131` |
| 8 | Apply runs search; Reset clears filters and anchor | `MC/components/timeline-filters.component.ts:54`, `:65`, `:181-191`; `MC/services/timeline-state.service.ts:105-116` |
| 9 | BM25 only badge when vec embeddings unavailable | `MC/components/timeline-filters.component.ts:133-140` |
| 10 | Empty state "No timeline events" + widen hint | `MC/components/timeline-view.component.ts:75-78` |
| 11 | Timeline button anchors; 5 before / 5 after | `MC/components/timeline-view.component.ts:102-105`; `MC/services/timeline-state.service.ts:139-150` |
| 12 | "Anchored on" + Clear anchor returns to filtered list | `MC/components/timeline-view.component.ts:41-55`, `:168-171` |
| 13 | Page size 50; Load more adds 50; shown when not exhausted | `MC/services/timeline-state.service.ts:28`, `:126-133`; `MC/components/timeline-view.component.ts:130-141` |
| 14 | Corpus = named snapshot of a memory filter; primeable | `MC/components/corpus-list.component.ts:129-130` |
| 15 | Prime opens chat session pre-loaded with corpus | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:547`; `MC/components/corpus-list.component.ts:354-375` |
| 16 | Corpus view = Suggested boards + Knowledge corpora | `MC/components/corpus-list.component.ts:60-69` |
| 17 | Row: name, memories count, built time, rebuilt time | `MC/components/corpus-list.component.ts:143-152` |
| 18 | Reprime ends primed sessions and opens a new one | `libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.ts:10`; `MC/components/corpus-list.component.ts:384` |
| 19 | Rebuild re-runs saved filter; shows added/removed | `.../system-namespace.builders.ts:545`; `MC/components/corpus-list.component.ts:400` |
| 20 | Delete confirms; memories kept, snapshot removed | `MC/components/corpus-list.component.ts:286-291` |
| 21 | Refresh button | `MC/components/corpus-list.component.ts:78-84` |
| 22 | Build corpus opens Build new corpus dialog | `MC/components/corpus-list.component.ts:89-92`; `MC/components/corpus-build-dialog.component.ts:50` |
| 23 | Dialog fields Name, type chips, Concepts, Files, Query (optional), Limit, Scope to current workspace | `MC/components/corpus-build-dialog.component.ts:55-142` |
| 24 | Limit default 100, max 500 | `MC/components/corpus-build-dialog.component.ts:127`, `:181` |
| 25 | Workspace scope on by default | `MC/components/corpus-build-dialog.component.ts:182` |
| 26 | Build enabled only with non-empty name | `MC/components/corpus-build-dialog.component.ts:184`, `:158-163` |
| 27 | Name must be unique | `libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.ts:79` |
| 28 | Built message names corpus and count | `MC/components/corpus-list.component.ts:344` |
| 29 | Suggested boards clustered from memories; card name, count, top concepts, rationale | `MC/components/corpus-suggestions.component.ts:54`, `:64-96` |
| 30 | Create builds; × dismisses | `MC/components/corpus-suggestions.component.ts:77-81`, `:103-110`; `MC/components/corpus-list.component.ts:259-271` |

## apps/ptah-docs/src/content/docs/memory/maintenance.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Maintenance view = Diagnostics + Danger zone | `MC/components/memory-curator-tab.component.ts:353`, `:248-268` |
| 2 | Last curator run card | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:55-58` |
| 3 | Triggers card with nine toggles, labels and units | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:66-125` |
| 4 | Check box toggles; number box disabled while off | `MC/components/diagnostics/memory-trigger-toggle.component.ts` (template: `[checked]`, `[disabled]="!enabled()"`) |
| 5 | Changes save through setTriggers | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:394-444` |
| 6 | Cue list (read-only) | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:133-142` |
| 7 | Curator model card; "Follows main agent" | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:155-165` |
| 8 | Change opens background model roles on Providers tab | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:458-464`; `ST/settings.component.ts:52-58`; `ST/providers/provider-consumer-assignments.component.ts:111` |
| 9 | Curator error alert with Open model settings | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:180-195`, `:476-480` |
| 10 | Recent events, max 10 rows, kind/outcome/relative time | `MC/components/diagnostics/event-feed.component.ts:21`, `:51-80`, `:97` |
| 11 | Skip reason text e.g. "Skipped: the provider is rate-limited" | `MC/components/diagnostics/event-feed.component.ts:26-38` |
| 12 | DB Health: coherent, rows, ✓ in sync | `MC/components/diagnostics/db-health-panel.component.ts:44-96`, `:372-391` |
| 13 | sqlite-vec reason/platform/error, Retry vec, Open binding folder | `MC/components/diagnostics/db-health-panel.component.ts:137-214`, `:436-437` |
| 14 | Embedder download first run then cached; Retry / download now; Re-warm | `MC/components/diagnostics/db-health-panel.component.ts:227-293` |
| 15 | Copy diagnostic | `MC/components/diagnostics/db-health-panel.component.ts:301` |
| 16 | Storage and Retention cards and fields | `MC/components/diagnostics/storage-health-panel.component.ts:124-290` |
| 17 | Run curator now curates active session once | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:221-235`, `:289-296` |
| 18 | Disabled with no session or when paused | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:223`, `:249`; `MC/services/memory-diagnostics-state.service.ts:56` |
| 19 | Refresh, How this works | `MC/components/diagnostics/memory-diagnostics-accordion.component.ts:254-262`, `:284` |
| 20 | Danger zone: permanent delete by subject pattern; also deletes matching pinned memories (fix #6) | `MC/components/memory-danger-zone.component.ts:25-29`; `libs/backend/memory-curator/src/lib/memory.store.ts:646-674` |
| 21 | Purge limited to open workspace | `MC/components/memory-curator-tab.component.ts:615-620`, `:639-643`; `libs/backend/memory-curator/src/lib/memory.store.ts:665-667` |
| 22 | substring: literal, `%`/`_` escaped; like: raw SQL LIKE | `libs/backend/memory-curator/src/lib/memory.store.ts:630-640`, `:655-664` |
| 23 | Mode select substring / like | `MC/components/memory-danger-zone.component.ts:47-72` |
| 24 | Confirm dialog before purge | `MC/components/memory-curator-tab.component.ts:622-625` |
| 25 | Result "Deleted N entries" | `MC/components/memory-curator-tab.component.ts:645-647` |
| 26 | Purge disabled without workspace or with scope All; Switch | `MC/components/memory-danger-zone.component.ts:91-106`, `:141-147`; `MC/components/memory-search-bar.component.ts:66`, `:76` |
| 27 | Forget is soft delete (link only) | `apps/ptah-docs/src/content/docs/memory/pinning-and-forgetting.md` (§ Forgetting) |

## apps/ptah-docs/src/content/docs/settings/search-and-voice.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Tab "Search & Voice" in Settings | `ST/settings.component.ts:204` |
| 2 | Sections: web search, voice, go vet (voice and go vet Electron) | `ST/search-voice-settings.component.ts:20-25` |
| 3 | Web search covered by providers/web-search (link only) | `apps/ptah-docs/src/content/docs/providers/web-search.md:20-33` |
| 4 | Voice engines heading and intro (chat mic, gateway voice notes, local offline, cloud key) | `ST/ptah-ai/voice-config.component.ts:72`, `:102-105` |
| 5 | Columns Direction, Provider, Model / Voice, Status, Details | `ST/ptah-ai/voice-config.component.ts:124-128` |
| 6 | Rows Speech-to-text / Text-to-speech; providers Local / ElevenLabs | `ST/ptah-ai/voice-config.component.ts:247-276`; `ST/ptah-ai/voice-config.component.ts:47-48` (label fallbacks, file line 247) |
| 7 | Status Ready / Not downloaded / No key | `ST/ptah-ai/voice-config.component.ts:55-57` |
| 8 | Provider popover; saves on selection; Unavailable reason | `ST/ptah-ai/voice-config.component.ts:74-80` (doc comment), `:164` |
| 9 | Details opens drawer for the direction | `ST/ptah-ai/voice-config.component.ts:186-187`; `ST/ptah-ai/voice-details-drawer.component.ts:25-26` |
| 10 | Whisper, curated download to ~/.ptah/models/ on first use | `ST/ptah-ai/local-stt-panel.component.ts:69-71` |
| 11 | Source Curated / HF repo id / Local folder; Save | `ST/ptah-ai/local-stt-panel.component.ts:284-286` |
| 12 | Default base.en; tiny fastest to large-v3-turbo most accurate | `ST/ptah-ai/local-stt-panel.component.ts:24-35` |
| 13 | Download; Downloaded / Not downloaded | `ST/ptah-ai/local-stt-panel.component.ts:198`, `:233`, `:244` |
| 14 | Kokoro, local, ~80 MB to ~/.ptah/models/ | `ST/ptah-ai/local-tts-panel.component.ts:76-78` |
| 15 | Voice select, Preview, Download | `ST/ptah-ai/local-tts-panel.component.ts:233`, `:294` |
| 16 | ElevenLabs needs saved key first; then pick provider | `ST/ptah-ai/voice-details-drawer.component.ts:94-97` |
| 17 | Test connection then Save | `ST/ptah-ai/elevenlabs-panel.component.ts:283`, `:302` |
| 18 | Key stored encrypted, never shown; Clear key | `ST/ptah-ai/elevenlabs-panel.component.ts:168`, `:208` |
| 19 | TTS voice list or Use voice ID | `ST/ptah-ai/elevenlabs-panel.component.ts:343`, `:404` |
| 20 | Heading "Diagnostics: go vet" | `ST/ptah-ai/go-vet-consent-config.component.ts:98` |
| 21 | What go vet reads/writes/does not run; not a sandbox; folder only | `ST/ptah-ai/go-vet-consent-config.component.ts:103-110` |
| 22 | Rows Workspace, Go binary ("none found on PATH") | `ST/ptah-ai/go-vet-consent-config.component.ts:128`, `:142` |
| 23 | Switch label; states On / Off / Out of date | `ST/ptah-ai/go-vet-consent-config.component.ts:155`, `:351-361` |
| 24 | Enable confirmation names folder; Allow go vet button | `ST/ptah-ai/go-vet-consent-config.component.ts:267-281` |
| 25 | Consent ends on move, replace, Go change; go vet stops until re-enabled | `ST/ptah-ai/go-vet-consent-config.component.ts:29-34`, `:109-110`, `:224-225` |

## apps/ptah-docs/src/content/docs/settings/context-management.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Tab label Context Management | `ST/settings.component.ts:202` |
| 2 | Section order | `ST/ptah-ai/orchestration-settings.component.ts:53-90` |
| 3 | Routing, rotation, matrix shown in Electron | `ST/ptah-ai/orchestration-settings.component.ts:77-81` |
| 4 | TTL label and values Auto (1 hour…) / 5 minutes / 1 hour | `ST/ptah-ai/subagent-cache-ttl-setting.component.ts:24`, `:29-33` |
| 5 | TTL default auto | `libs/backend/platform-core/src/file-settings-keys.ts:364` |
| 6 | Env var precedence notice; invalid ignored | `ST/ptah-ai/subagent-cache-ttl-setting.component.ts:23`, `:42-45`, `:96-103` |
| 7 | Session budget section (link) | `ST/ptah-ai/orchestration-settings.component.ts:65`; `apps/ptah-docs/src/content/docs/sessions/cost-summary.md:19` |
| 8 | Lane guards heading, intro, no tool-call limit | `ST/ptah-ai/lane-guards-settings.component.ts:60-63`, `:98-101` |
| 9 | Repeat-call stop at, default 20, min 2, unit calls | `ST/ptah-ai/lane-guards-settings.logic.ts:20-33`; `ST/ptah-ai/lane-guards-settings.component.ts:129-133` |
| 10 | Routing suggestions label, help, default true | `ST/ptah-ai/host-routing-setting.component.ts:23`, `:85-88`; `libs/backend/platform-core/src/file-settings-keys.ts:372` |
| 11 | Disabled without decision model; message text | `ST/ptah-ai/host-routing-setting.component.ts:66` (`[disabled]="!modelConfigured()"`), `:128` |
| 12 | Rotate close executors label, help, default true, Last pick | `ST/ptah-ai/lane-rotation-setting.component.ts:21`, `:76-82`; `libs/backend/platform-core/src/file-settings-keys.ts:374` |
| 13 | Capability matrix columns, unrated, stale yes/no, empty state | `ST/ptah-ai/capability-matrix-setting.component.ts:56-57`, `:96`, `:103-109`, `:193-197` |
| 14 | Context budgets description and six fields, defaults, ranges | `libs/shared/src/lib/types/advanced-settings.types.ts:93-97`, `:138-211` |
| 15 | Apply notes live / next-agent | `libs/shared/src/lib/types/advanced-settings.types.ts:138-282` (`apply`); `ST/advanced/advanced-settings-group.component.ts:41-43` |
| 16 | Codex agents fields, keys, defaults | `libs/shared/src/lib/types/advanced-settings.types.ts:99-102`, `:213-247` |
| 17 | Codex sandbox applies to new chat turns and CLI lanes | `ST/advanced/codex-sandbox-setting.component.ts:126-133` |
| 18 | Four modes and their help text | `ST/advanced/codex-sandbox-setting.component.ts:38-39`, `:51-66` |
| 19 | Full access is default | `libs/shared/src/lib/types/advanced-settings.types.ts:25`; `libs/backend/platform-core/src/file-settings-keys.ts:347` |
| 20 | Confirm before switching to full access; Use full access | `ST/advanced/codex-sandbox-setting.component.ts:105-107`, `:236`, `:249` |
| 21 | Windows workspace-write note | `ST/advanced/codex-sandbox-setting.component.ts:76-77` |
| 22 | Precedence over ~/.codex/config.toml; next turn; In effect | `ST/advanced/codex-sandbox-setting.component.ts:270-290` |
| 23 | Approval prompts follow permission level; lanes no prompts | `ST/advanced/codex-sandbox-setting.component.ts:293-295` |
| 24 | Background query limits description, three fields | `libs/shared/src/lib/types/advanced-settings.types.ts:104-108`, `:249-287` |
| 25 | Claude Code tools & skills on Advanced tab | `ST/advanced-settings.component.ts:167`; `ST/pro-features/claude-builtins-config.component.ts:87` |
| 26 | Purpose: fewer items smaller first message | `ST/pro-features/claude-builtins-config.component.ts:91-92` |
| 27 | Applies to new sessions; all workspaces | `ST/pro-features/claude-builtins-config.component.ts:99-100` |
| 28 | Token estimate of hidden items | `ST/pro-features/claude-builtins-config.component.ts:120` |
| 29 | Three groups, defaults, columns | `ST/pro-features/claude-builtins-config.component.ts:126-140`, `:185-196`, `:251-265` |
| 30 | Skill needs tool; both must be on; "tool is off" | `ST/pro-features/claude-builtins-config.component.ts:128-130`, `:222-228` |

## apps/ptah-docs/src/content/docs/mcp-and-skills/external-callers.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Every request checked; caller can send a token with one level; no token → read-only (fix #1) | `CE/mcp-http/mcp-http-gate.ts:1-4`; `libs/backend/platform-core/src/interfaces/mcp-caller-credentials.interface.ts:15`; `CE/mcp-core/mcp-caller-policy.ts:14-15`; `CE/mcp-http/mcp-caller-token-registry.ts:333-339` |
| 2 | Levels read-only / lane-report / privileged and what each permits | `CE/mcp-core/mcp-caller-policy.ts:32-64`, `:121-137` |
| 3 | Lane report tools list | `CE/mcp-core/mcp-caller-policy.ts:121-125` |
| 4 | Privileged permits all incl. execute_code | `CE/mcp-core/mcp-caller-policy.ts:105`, `:135` |
| 5 | Lane report tools accept lane report; all other non-read tools need privileged (fix #2) | `CE/mcp-core/mcp-caller-policy.ts:2-6`, `:111`, `:121-137` |
| 6 | Denied call refused | `CE/mcp-http/http-server.handler.ts:555` |
| 7 | Lane tokens per lane, up to 4 hours | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/lane-mcp-credentials.ts:5-35` |
| 8 | Antigravity lanes lane-report; other lanes privileged | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1014` |
| 9 | External callers read token from config file; level from setting | `CE/mcp-http/mcp-caller-token-registry.ts:4-12`, `:517-521` |
| 10 | Config file table (targets, files, scopes, Codex trust) | `CE/mcp-http/ptah-mcp-slots.ts:18-25`, `:41-46` |
| 11 | Cursor/Codex/Antigravity written only when detected | `CE/mcp-http/ptah-mcp-slots.ts:18-25` ("Gated on detection") |
| 12 | Cursor token in Authorization header; others in URL | `CE/mcp-http/http-mcp-server.service.ts:1057-1062` |
| 13 | Persistent tokens stable across stop/start; only hash stored | `CE/mcp-http/mcp-caller-token-registry.ts:4-8`; commit `9101d8bc6` message |
| 14 | Setting location Settings → Advanced → MCP & Browser | `ST/pro-features/mcp-port-config.component.ts:64`, `:134` |
| 15 | Values Read-only (recommended) / Full access; help text | `ST/pro-features/mcp-port-config.component.ts:144-153` |
| 16 | Default read-only; invalid reads as read-only | `libs/backend/platform-core/src/file-settings-keys.ts:378`; `CE/mcp-core/mcp-caller-auth.types.ts:26-33` |
| 17 | Full access only for workspace slots; home always read-only | `CE/mcp-http/mcp-caller-token-registry.ts:12`, `:520-521` |
| 18 | Host must be localhost/127.0.0.1/[::1] with port | `CE/mcp-http/mcp-http-gate.ts:31-40`; `CE/mcp-http/http-server.handler.ts:381-384` |
| 19 | Any Origin header refused | `CE/mcp-http/mcp-http-gate.ts:42-50`; `CE/mcp-http/http-server.handler.ts:387-390` |
| 20 | Content-Type must be application/json | `CE/mcp-http/mcp-http-gate.ts:53-58`; `CE/mcp-core/mcp-caller-auth.types.ts:22-23` |

## Cross-links added

| File | Line | Link |
|---|---|---|
| `apps/ptah-docs/src/content/docs/memory/index.mdx` | 43 | One line after the CardGrid: `/memory/timeline-and-corpus/`, `/memory/maintenance/` |
| `apps/ptah-docs/src/content/docs/settings/index.mdx` | 38 | "In this section" list: `/settings/context-management/`, `/settings/search-and-voice/` |
| `apps/ptah-docs/src/content/docs/mcp-and-skills/built-in-mcp-server.md` | 52 (fix round also changed lines 16, 41, 48 for defects 3-5) | "Next steps" list: `/mcp-and-skills/external-callers/` |

## Sidebar request

| Slug | Label | Group |
|---|---|---|
| `memory/timeline-and-corpus` | Timeline & Corpus | Memory (after Searching) |
| `memory/maintenance` | Maintenance | Memory (after Pinning & Forgetting, before Settings) |
| `settings/context-management` | Context Management | Settings (after Workspace settings) |
| `settings/search-and-voice` | Search & Voice | Settings (after Context Management) |
| `mcp-and-skills/external-callers` | External MCP Callers | MCP & Skills (after Built-in MCP Server) |

## Decisions

1. **Search options (B-75)**: `providers/web-search.md` already documents the Search & Voice web search steps and keys. `settings/search-and-voice.md` links to it and does not repeat it.
2. **Claude built-ins (B-72)** are on the **Advanced** tab, not on Context Management (`ST/advanced-settings.component.ts:167`). As the lane prompt asked, they are on `settings/context-management.md` in a section that names the Advanced tab, because the feature is about token cost. The orchestrator can move the section if it prefers.
3. **Partial rows**: B-61 (Subagent prompt-cache TTL), B-63 (Lane guards) and B-66 (Codex agents group and Codex sandbox mode) are in the Context Management tab, so the page covers them. B-62 (Session budget) is only linked to `sessions/cost-summary/#settings`.
4. **memory/maintenance.md** links to `memory/settings/#triggers` and `#retention` for keys and defaults, and to `memory/pinning-and-forgetting/` for Forget. It does not repeat them.
5. **built-in-mcp-server.md** had three errors. The fix round corrected them (see `fix-w2-report.md`, defects 3-5):
   a request without a token gets read-only access (`CE/mcp-core/mcp-caller-policy.ts:14-15`); the server also writes
   its entry to Cursor, Codex and Antigravity config files when it finds them (`CE/mcp-http/ptah-mcp-slots.ts:18-25`);
   with Full access, home-folder tokens stay read-only (`CE/mcp-http/mcp-caller-token-registry.ts:516-521`).
   `external-callers.md` now also states the read-only access without a token (fix #1).
6. **Purge and pinned memories**: the purge SQL has no pinned filter (`libs/backend/memory-curator/src/lib/memory.store.ts:666-667`).
   The fix round added an explicit warning to the caution in `memory/maintenance.md` (fix #6).
7. **Curator model "Change"** requests the Context Management tab id with section `background-models`, which the Settings shell routes to the Providers tab (`ST/settings.component.ts:52-58`). The page says it opens the background model roles on the Providers tab.
8. Settings pages use no `# H1` (siblings have none); memory pages use one (siblings have one). No `sidebar: order` is used by siblings, so none was added.

## Clarifications Needed

None.
