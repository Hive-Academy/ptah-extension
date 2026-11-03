# Video move inventory

Read-only audit of tracked files at this worktree. Counts below come from `git ls-files` and exclude untracked media. `MOVE-AS-SOURCE` means copy to the destination before deleting here; `DELETE-ONLY` is a repo-specific reference or target; `SPLIT` means retain the nonvideo part and edit only video-specific content. Nothing was moved or deleted in this task.

## Tracked source trees

| Repo-relative path | Tracked files | Disposition | Character |
| --- | ---: | --- | --- |
| `apps/ptah-video-studio/` | 181 | MOVE-AS-SOURCE | Ptah-specific Remotion studio, scripts, music/SFX/model assets and instructions |
| `tools/hyperframes/` | 140 | MOVE-AS-SOURCE | Generic HyperFrames renderer with Ptah-specific kit and campaigns |
| `libs/showcase-manifest/` | 6 | MOVE-AS-SOURCE | Generic capture/render manifest contract with Ptah package alias |
| `plugins/ptah-video/` | 6 | MOVE-AS-SOURCE | Generic video skill packaged for Ptah |
| `.claude/skills/video-showcase/` | 5 | MOVE-AS-SOURCE | workspace mirror of video skill |
| `docs/video-scripts/` | 18 | MOVE-AS-SOURCE | Ptah-specific editorial scripts |
| `apps/ptah-electron-e2e/src/showcase/` | 31 | MOVE-AS-SOURCE | Ptah-specific marketing capture scenes and reusable capture harness |
| `docs/video-series-saas-on-open-weights.md` | 1 | MOVE-AS-SOURCE | Ptah-specific episode plan |
| `.claude/agents/video-director.md`, `.codex/agents/video-director.toml`, `.opencode/agent/video-director.md` | 3 | MOVE-AS-SOURCE | Tracked Ptah-specific provider agent definitions; confirmed by `git ls-files` |
| `libs/backend/agent-generation/templates/agents/video-director.template.md` | 1 | MOVE-AS-SOURCE | Ptah-specific generated agent template |
| `.claude/skills/technical-content-writer/VIDEO-SCRIPTS.md`, `plugins/ptah-core/skills/technical-content-writer/VIDEO-SCRIPTS.md` | 2 | SPLIT | Generic technical writer remains; video-script reference moves; update parent `SKILL.md` references |

`tools/hyperframes/` contains `kits/ptah-ui/` (40 files, private/Ptah-specific), `projects/agent-lanes-chat/` (14), `agent-lanes-explainer/` (19), `agent-lanes-v2/` (38), `agent-lanes-v3/` (16), `agentic-factory-promo/` (8), plus five root files. Treat the renderer as generic; the kit and campaigns are Ptah-specific. The video studio contains licensed music, SFX and models; transfer their credit files together with the assets.

No tracked `.agents/` video skill or agent exists in this checkout. The other name-matching `.claude/skills/angular-3d-scene-crafter/` and `angular-gsap-animation-crafter/` files are generic UI/animation examples, so retain them. Root `scripts/` has no dedicated render script outside the studio; `scripts/reset-ptah-dev-profile.sh` only mentions video as one dev use, and `scripts/generate-content-manifest.js:81,84` uses “showcase” in generic Angular example filenames.

**Main checkout, untracked:** `D:\projects\ptah-extension\tools\video-editor` exists, is ignored by `.gitignore:240-255`, is private/Ptah-specific and approximately 11 GB per task brief. It is outside this worktree and has **0 tracked files** here. List it for a separate private transfer; do not read or traverse its media.

## Electron e2e split

`apps/ptah-electron-e2e/src/showcase/` has 31 tracked capture files: 6 `_harness/*.ts`, 13 `*.scene.ts`, and 12 `scripts/*.json`. Every one is **MOVE-AS-SOURCE**; none is imported by a real `src/specs/**/*.spec.ts` test or `src/support/**` file (`git grep -n -F -e 'showcase-manifest' -e 'src/showcase' -e 'showcase.config' -- apps/ptah-electron-e2e/src/specs apps/ptah-electron-e2e/src/support` returned no matches). `playwright.config.ts:18-20` collects only `src/specs/**/*.spec.ts`; `showcase.config.ts:20-21` collects only `src/showcase/**/*.scene.ts`. The capture file list below is also the per-file real-e2e import verdict: **No** for each.

| Path outside `src/showcase/` | Disposition | Reason |
| --- | --- | --- |
| `apps/ptah-electron-e2e/showcase.config.ts` | MOVE-AS-SOURCE | Marketing capture Playwright config only |
| `apps/ptah-electron-e2e/scripts/clean-recordings.mjs` | MOVE-AS-SOURCE | Recording cleanup only |
| `apps/ptah-electron-e2e/scripts/transcode.mjs` | MOVE-AS-SOURCE | Marketing WebM-to-MP4 conversion only |
| `apps/ptah-electron-e2e/project.json:32-74` | SPLIT | Remove `showcase` and `showcase:lane-review`; keep `e2e`, `e2e:nightly`, `typecheck` and Electron dependencies |
| `apps/ptah-electron-e2e/tsconfig.spec.json:8` | SPLIT | Narrow `src/**/*.ts` after move if typecheck should cover only kept specs/support/docs shots |
| `apps/ptah-electron-e2e/README.md:82-125` | SPLIT | Remove marketing showcase section; preserve real e2e guide |
| `apps/ptah-electron-e2e/playwright.config.ts`, `src/specs/**`, `src/support/**`, `scripts/measure-boot-rpcs.mjs` | SPLIT/KEEP | Real Electron tests and support remain; Playwright's `video: 'off'` is normal test config, not marketing tooling |
| `apps/ptah-electron-e2e/docs-screenshots.config.ts`, `src/docs-screenshots/**` (7 files) | SPLIT/KEEP | Docs screenshot capture remains; `apps/ptah-docs/project.json:27-35` invokes it |
| `apps/ptah-electron-e2e/src/support/new-session-trigger.ts` | SPLIT | Scenes import it (`canvas-orchestra`, `chat-code-edit`, `lane-console-review`), but `src/support/ui-driver.ts:2,446` also uses it; retain here and copy/adapt in destination |

`libs/frontend/webview-e2e-harness/` has 84 tracked files and **stays**. It has no `showcase-manifest` import. Its `src/lib/scenarios/onboarding/onboarding-ready-capture.ts` is used by four retained visual e2e specs (`onboarding-analyze-visual.e2e.spec.ts:30`, `onboarding-generate-visual.e2e.spec.ts:14`, `onboarding-proposal-visual.e2e.spec.ts:12`, `onboarding-ready-visual.e2e.spec.ts:43`). `settings/settings-reachability.table.ts:1682` has only a comment pointing at the marketing scene; edit that comment. The only production `@ptah-extension/showcase-manifest` imports are `apps/ptah-electron-e2e/src/showcase/_harness/director.ts:10` and three `apps/ptah-video-studio/src/**` files; no other retained library imports it. `tools/mcp-bench` contains path snapshots, not imports.

## Repo wiring and references

| Path / line | Disposition | Action |
| --- | --- | --- |
| `package.json:9` | DELETE-ONLY | Remove root `studio` script; package decisions in companion plan |
| `apps/ptah-video-studio/project.json` | MOVE-AS-SOURCE | All studio Nx targets move with project |
| `apps/ptah-electron-e2e/project.json:32-74` | SPLIT | Remove two showcase Nx targets |
| `tsconfig.base.json:20-22` | DELETE-ONLY | Remove `@ptah-extension/showcase-manifest` alias after move |
| `nx.json:184` | DELETE-ONLY | Remove video studio from `@nx/eslint/plugin` include list; no video-specific target default or release config found |
| `eslint.config.mjs:207-213` | DELETE-ONLY | Remove studio output ignores |
| `eslint.config.mjs:365-367` | SPLIT | Replace showcase-manifest example; keep `scope:e2e` rule for real e2e |
| `.gitignore:7-9,227-228,240-255` | DELETE-ONLY | Remove `video-output/`, studio build/selfshot rules and video-editor ignore after private transfer; keep generic ignores |
| `.github/workflows/render-showcase.yml`, `.github/workflows/upload-recordings.yml` | MOVE-AS-SOURCE | Entire marketing render/upload workflows; remove them from this repo after adapting destination secrets/paths |
| `scripts/reset-ptah-dev-profile.sh:6,24` | SPLIT | Generic dev reset may stay; remove video-only prose/options only if no retained dev use |
| `.claude/skills/orchestration/references/agent-catalog.md:26,47,95,150` and `plugins/ptah-core/skills/orchestration/references/agent-catalog.md:26,47,95,150` | SPLIT | Remove video-director rows; keep generic orchestration catalog |
| `.claude/skills/technical-content-writer/SKILL.md:48` and mirrored `plugins/ptah-core/skills/technical-content-writer/SKILL.md` | SPLIT | Update reference to moved VIDEO-SCRIPTS material |
| `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:404-414` | SPLIT | Remove `ptah-video` built-in plugin catalog entry if plugin leaves app distribution |
| `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-catalogue.ts:211-214` | SPLIT | Remove `/video-showcase` shortcut |
| `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts:48,164,221`, `subagent-tool-allowlist.ts:64,83`, `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:677,691-693` | SPLIT | Remove video-director roster, allowlist and setup special case; update their adjacent specs |
| `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.spec.ts`, `orchestrator.service.spec.ts`, `subagent-tool-allowlist.spec.ts`, `template-sharing.guard.spec.ts`, `user-layer/user-layer-agent-scope.spec.ts`, `user-layer/user-layer-seed-quarantine.spec.ts`, `user-layer/user-layer-seed-quarantine.ts`, `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`, `libs/frontend/skill-synthesis-ui/src/lib/components/clones/quarantined-agents-panel.component.spec.ts` | SPLIT | Update explicit video-director expectations/fixtures without dropping generic quarantine coverage |
| `scripts/validate-orchestration-skill.ts:104` | SPLIT | Remove stale video-director example only |
| `libs/backend/harness-sync/src/lib/gitignore/gitignore-writer.ts:22,290,313` and `gitignore-writer.spec.ts` | SPLIT | Generic gitignore writer stays; replace hard-coded video-showcase examples in comments/spec fixtures |
| `tools/mcp-bench/fixtures/memory-skills/planted-negatives.v1/index.json`, `pn-08.md`, `skill-triggers.v2.jsonl`, `baseline/gate-baseline.json`, `questions/7910f34cf/{definitions,dependents,file-tools,references,relevance,symbols-concept,symbols-exact}.json` | SPLIT | Retained benchmark contains video skill and old path snapshots; rebaseline or keep historical data intentionally, never treat as runtime consumers |
| `README.md:19-36` | SPLIT | Public video links and YouTube demo remain live content; migrate URLs/assets before deleting clips |
| `apps/ptah-docs/src/content/docs/agents/built-in-agents.md:8,83-85`, `setup/setup-wizard.md:49`, `mcp-and-skills/popular-skills.md:75-79`, `plugins/index.md:32,51`, `plugins/marketplace.md:25`, `plugins/plugin-storage.md:20` | SPLIT | Update docs for removed agent/skill/plugin |
| `apps/ptah-docs/public/assets/videos/*.mp4` (8 tracked files) | SPLIT | Finished product clips are Ptah-specific; move to external asset hosting only with URL rewrite in docs/README |
| `apps/ptah-docs/src/content/docs/agents/agent-orchestration.md:11`, `getting-started/installation.md:9`, `getting-started/signing-in.md:12`, `mcp-and-skills/built-in-mcp-server.md:9`, `plugins/index.md:9`, `providers/index.md:13`, `setup/setup-wizard.md:9`, `workspace/project-analysis.md:11` | SPLIT | Eight live `<source src="/assets/videos/...">` embeds; rewrite with hosted URLs before moving the eight MP4 assets |
| `apps/ptah-landing-page/public/assets/images/showcase/*.webp` (8 tracked files) | SPLIT/KEEP | Live landing-page images, not capture tooling; retain unless asset migration is separately planned |

`apps/ptah-electron-e2e/showcase.config.ts:9` and `README.md:124` point to `docs/video-content-plan.md`, which is **not tracked and does not exist**. Remove or repair this stale reference in the destination. `CLAUDE.md`, `AGENTS.md`, and `CONTRIBUTING.md` contain no path to the moved video trees; `AGENTS.md:32-41` explicitly keeps Electron and CLI libraries. No video-specific Jest config or `moduleNameMapper` entry was found; VS Code mocks in retained Jest configs still serve retained backend libraries.

## Exact tracked-file manifest

The lists are generated directly from `git ls-files` for each move tree, so the path count is checkable.

### `apps/ptah-video-studio/` ? 181 files (MOVE-AS-SOURCE)

- `apps/ptah-video-studio/.env.example`
- `apps/ptah-video-studio/.gitignore`
- `apps/ptah-video-studio/FOLLOW-UP.md`
- `apps/ptah-video-studio/PORT-TO-NEW-PROJECT.md`
- `apps/ptah-video-studio/README.md`
- `apps/ptah-video-studio/RECORDING.md`
- `apps/ptah-video-studio/ROADMAP.md`
- `apps/ptah-video-studio/assets/README.md`
- `apps/ptah-video-studio/assets/music/.gitkeep`
- `apps/ptah-video-studio/assets/music/MUSIC-CREDITS.md`
- `apps/ptah-video-studio/assets/music/mixkit-better-times-are-coming.mp3`
- `apps/ptah-video-studio/assets/music/mixkit-close-up.mp3`
- `apps/ptah-video-studio/assets/music/mixkit-deep-techno-ambience.mp3`
- `apps/ptah-video-studio/assets/music/mixkit-digital-clouds.mp3`
- `apps/ptah-video-studio/assets/music/mixkit-minimal-emotion.mp3`
- `apps/ptah-video-studio/assets/music/mixkit-uplifting-bass.mp3`
- `apps/ptah-video-studio/assets/music/rising-dawn.mp3`
- `apps/ptah-video-studio/assets/sfx/.gitkeep`
- `apps/ptah-video-studio/assets/sfx/SFX-CREDITS.md`
- `apps/ptah-video-studio/assets/sfx/chime.mp3`
- `apps/ptah-video-studio/assets/sfx/pop.mp3`
- `apps/ptah-video-studio/assets/sfx/ring.mp3`
- `apps/ptah-video-studio/assets/sfx/tick.mp3`
- `apps/ptah-video-studio/assets/sfx/whoosh.mp3`
- `apps/ptah-video-studio/docs/feature-knowledge-base.md`
- `apps/ptah-video-studio/docs/video-script.md`
- `apps/ptah-video-studio/package.json`
- `apps/ptah-video-studio/preview.props.json`
- `apps/ptah-video-studio/project.json`
- `apps/ptah-video-studio/promos/agent-showcase-pilot.json`
- `apps/ptah-video-studio/promos/asset-sheet.json`
- `apps/ptah-video-studio/promos/dyad-vs-ptah-landscape.json`
- `apps/ptah-video-studio/promos/dyad-vs-ptah-vertical.json`
- `apps/ptah-video-studio/promos/glass-hero-check.json`
- `apps/ptah-video-studio/promos/mcp-code-execution.json`
- `apps/ptah-video-studio/promos/provider-orbit-pilot.json`
- `apps/ptah-video-studio/promos/ptah-builders-launch-vertical.json`
- `apps/ptah-video-studio/promos/ptah-builders-launch.json`
- `apps/ptah-video-studio/promos/ptah-saas-story.json`
- `apps/ptah-video-studio/promos/ptah-tui-reel.json`
- `apps/ptah-video-studio/promos/ptah-xirp-answer.json`
- `apps/ptah-video-studio/promos/state-of-art-proof.json`
- `apps/ptah-video-studio/public/brand/ptah-icon.png`
- `apps/ptah-video-studio/public/models/BoomBox.glb`
- `apps/ptah-video-studio/public/models/CREDITS.md`
- `apps/ptah-video-studio/public/models/Lantern.glb`
- `apps/ptah-video-studio/public/models/RobotExpressive.glb`
- `apps/ptah-video-studio/public/models/ToyCar.glb`
- `apps/ptah-video-studio/public/models/computer.glb`
- `apps/ptah-video-studio/public/models/drone.glb`
- `apps/ptah-video-studio/public/models/rocket.glb`
- `apps/ptah-video-studio/remotion.config.ts`
- `apps/ptah-video-studio/scripts/caption.mjs`
- `apps/ptah-video-studio/scripts/export-kit.mjs`
- `apps/ptah-video-studio/scripts/gen-qr.mjs`
- `apps/ptah-video-studio/scripts/lib/master-audio.mjs`
- `apps/ptah-video-studio/scripts/lib/media.mjs`
- `apps/ptah-video-studio/scripts/lib/qrcode.mjs`
- `apps/ptah-video-studio/scripts/lib/selfshot-paths.mjs`
- `apps/ptah-video-studio/scripts/lib/selfshot-resolve.mjs`
- `apps/ptah-video-studio/scripts/lib/tts.mjs`
- `apps/ptah-video-studio/scripts/master.mjs`
- `apps/ptah-video-studio/scripts/narrate.mjs`
- `apps/ptah-video-studio/scripts/paths.mjs`
- `apps/ptah-video-studio/scripts/polish.mjs`
- `apps/ptah-video-studio/scripts/render-all.mjs`
- `apps/ptah-video-studio/scripts/render-outro.mjs`
- `apps/ptah-video-studio/scripts/render-promo.mjs`
- `apps/ptah-video-studio/scripts/selfshot-draft-beats.mjs`
- `apps/ptah-video-studio/scripts/selfshot-narrate.mjs`
- `apps/ptah-video-studio/scripts/selfshot-render.mjs`
- `apps/ptah-video-studio/scripts/selfshot-transcribe.mjs`
- `apps/ptah-video-studio/scripts/text-normalization.json`
- `apps/ptah-video-studio/scripts/tui-frames.mjs`
- `apps/ptah-video-studio/selfshot/README.md`
- `apps/ptah-video-studio/selfshot/_smoke/beats.json`
- `apps/ptah-video-studio/selfshot/_smoke/words.json`
- `apps/ptah-video-studio/selfshot/ptah-opensource/beats.json`
- `apps/ptah-video-studio/selfshot/ptah-opensource/words.json`
- `apps/ptah-video-studio/selfshot/ptah-opensource/words.raw.json`
- `apps/ptah-video-studio/selfshot/tribunal-intro/beats.json`
- `apps/ptah-video-studio/src/PromoReel.tsx`
- `apps/ptah-video-studio/src/Root.tsx`
- `apps/ptah-video-studio/src/ShowcaseVideo.tsx`
- `apps/ptah-video-studio/src/brand.config.ts`
- `apps/ptah-video-studio/src/components/AmbientOrbs.tsx`
- `apps/ptah-video-studio/src/components/Backdrop.tsx`
- `apps/ptah-video-studio/src/components/BodyScene.tsx`
- `apps/ptah-video-studio/src/components/Callout.tsx`
- `apps/ptah-video-studio/src/components/DeviceFrame.tsx`
- `apps/ptah-video-studio/src/components/IntroCard.tsx`
- `apps/ptah-video-studio/src/components/LowerThird.tsx`
- `apps/ptah-video-studio/src/components/OutroCard.tsx`
- `apps/ptah-video-studio/src/components/ProgressBar.tsx`
- `apps/ptah-video-studio/src/components/PromoSoundDesign.tsx`
- `apps/ptah-video-studio/src/components/SectionTransition.tsx`
- `apps/ptah-video-studio/src/components/SoundDesign.tsx`
- `apps/ptah-video-studio/src/components/TerminalPlayer.tsx`
- `apps/ptah-video-studio/src/components/Watermark.tsx`
- `apps/ptah-video-studio/src/components/effects/AnimatedGridPattern.tsx`
- `apps/ptah-video-studio/src/components/effects/BorderBeam.tsx`
- `apps/ptah-video-studio/src/components/effects/Marquee.tsx`
- `apps/ptah-video-studio/src/components/effects/Meteors.tsx`
- `apps/ptah-video-studio/src/components/effects/Particles.tsx`
- `apps/ptah-video-studio/src/components/effects/ShimmerSweep.tsx`
- `apps/ptah-video-studio/src/components/effects/index.ts`
- `apps/ptah-video-studio/src/components/effects/seeded-random.ts`
- `apps/ptah-video-studio/src/concept/ColdStart.tsx`
- `apps/ptah-video-studio/src/concept/Contenders.tsx`
- `apps/ptah-video-studio/src/concept/DecisionTree.tsx`
- `apps/ptah-video-studio/src/concept/DyadArchitecture.tsx`
- `apps/ptah-video-studio/src/concept/DyadCeiling.tsx`
- `apps/ptah-video-studio/src/concept/GlassCoreScene.tsx`
- `apps/ptah-video-studio/src/concept/Philosophy.tsx`
- `apps/ptah-video-studio/src/concept/PtahOrchestra.tsx`
- `apps/ptah-video-studio/src/concept/PtahQuadrant.tsx`
- `apps/ptah-video-studio/src/concept/PtahRoadmap.tsx`
- `apps/ptah-video-studio/src/concept/StateOfArtProof.tsx`
- `apps/ptah-video-studio/src/concept/TheFork.tsx`
- `apps/ptah-video-studio/src/concept/answer-scenes.tsx`
- `apps/ptah-video-studio/src/concept/builders-scenes.tsx`
- `apps/ptah-video-studio/src/concept/index.tsx`
- `apps/ptah-video-studio/src/concept/scene-kit.tsx`
- `apps/ptah-video-studio/src/concept/story-kit-3d.tsx`
- `apps/ptah-video-studio/src/concept/story-kit.tsx`
- `apps/ptah-video-studio/src/concept/story-scenes-v2.tsx`
- `apps/ptah-video-studio/src/concept/story-scenes.tsx`
- `apps/ptah-video-studio/src/concept/xirp-kit.tsx`
- `apps/ptah-video-studio/src/concept3d/AgentShowcase.tsx`
- `apps/ptah-video-studio/src/concept3d/AssetSheet.tsx`
- `apps/ptah-video-studio/src/concept3d/GlassHero.tsx`
- `apps/ptah-video-studio/src/concept3d/McpOneTool.tsx`
- `apps/ptah-video-studio/src/concept3d/McpResult.tsx`
- `apps/ptah-video-studio/src/concept3d/McpRoundtrips.tsx`
- `apps/ptah-video-studio/src/concept3d/McpSandbox.tsx`
- `apps/ptah-video-studio/src/concept3d/ProviderOrbit.tsx`
- `apps/ptah-video-studio/src/concept3d/three-assets.tsx`
- `apps/ptah-video-studio/src/concept3d/three-kit.tsx`
- `apps/ptah-video-studio/src/lib/load-manifest.ts`
- `apps/ptah-video-studio/src/lib/shots.ts`
- `apps/ptah-video-studio/src/remocn/components/remocn/blur-out-up/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/caret/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/claude-code/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/focus-pull/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/glass-code-block/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/number-wheel/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/progress-steps/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/push-through/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/rolling-number/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/shader-mesh-gradient/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/shader-neuro-noise/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/soft-blur-in/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/stepper/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/stepper/use-stepper-transition.ts`
- `apps/ptah-video-studio/src/remocn/components/remocn/terminal-simulator/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/tracking-in/index.tsx`
- `apps/ptah-video-studio/src/remocn/components/remocn/whip-pan/index.tsx`
- `apps/ptah-video-studio/src/remocn/lib/remocn-ui/color.ts`
- `apps/ptah-video-studio/src/remocn/lib/remocn-ui/index.ts`
- `apps/ptah-video-studio/src/remocn/lib/remocn-ui/motion.ts`
- `apps/ptah-video-studio/src/remocn/lib/remocn-ui/theme.ts`
- `apps/ptah-video-studio/src/remocn/lib/remocn-ui/timeline.ts`
- `apps/ptah-video-studio/src/remocn/lib/remocn-ui/types.ts`
- `apps/ptah-video-studio/src/selfshot/CameraBubble.tsx`
- `apps/ptah-video-studio/src/selfshot/EndCard.tsx`
- `apps/ptah-video-studio/src/selfshot/Hybrid.tsx`
- `apps/ptah-video-studio/src/selfshot/Outro.tsx`
- `apps/ptah-video-studio/src/selfshot/ScreenDemo.tsx`
- `apps/ptah-video-studio/src/selfshot/ScreenStage.tsx`
- `apps/ptah-video-studio/src/selfshot/Shell.tsx`
- `apps/ptah-video-studio/src/selfshot/TalkingHead.tsx`
- `apps/ptah-video-studio/src/selfshot/constants.ts`
- `apps/ptah-video-studio/src/selfshot/graphics.tsx`
- `apps/ptah-video-studio/src/selfshot/icons.tsx`
- `apps/ptah-video-studio/src/selfshot/manifest.ts`
- `apps/ptah-video-studio/src/selfshot/metadata.ts`
- `apps/ptah-video-studio/src/selfshot/overlays.tsx`
- `apps/ptah-video-studio/src/selfshot/resolved.ts`
- `apps/ptah-video-studio/src/selfshot/waitlist-qr.ts`
- `apps/ptah-video-studio/src/theme.ts`
- `apps/ptah-video-studio/tsconfig.json`

### `tools/hyperframes/` ? 140 files (MOVE-AS-SOURCE)

- `tools/hyperframes/.gitignore`
- `tools/hyperframes/HANDOFF.md`
- `tools/hyperframes/PLAYBOOK.md`
- `tools/hyperframes/README.md`
- `tools/hyperframes/kits/ptah-ui/SPEC.md`
- `tools/hyperframes/kits/ptah-ui/build.mjs`
- `tools/hyperframes/kits/ptah-ui/gallery/AGENTS.md`
- `tools/hyperframes/kits/ptah-ui/gallery/CLAUDE.md`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/antigravity.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/claude.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/copilot.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/cursor.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/kimi.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/lmstudio.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/ollama.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/openai.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/opencode.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/openrouter.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/assets/logos/zai.svg`
- `tools/hyperframes/kits/ptah-ui/gallery/hyperframes.json`
- `tools/hyperframes/kits/ptah-ui/gallery/index.html`
- `tools/hyperframes/kits/ptah-ui/gallery/meta.json`
- `tools/hyperframes/kits/ptah-ui/gallery/package.json`
- `tools/hyperframes/kits/ptah-ui/reference/agents-panel-report-delivered.png`
- `tools/hyperframes/kits/ptah-ui/reference/anubis-app.css`
- `tools/hyperframes/kits/ptah-ui/reference/app-window-multi-session.png`
- `tools/hyperframes/kits/ptah-ui/reference/contract-example-notification-stack.html`
- `tools/hyperframes/kits/ptah-ui/reference/lane-transcript-overlay.png`
- `tools/hyperframes/kits/ptah-ui/reference/subagent-cards-message-agent.png`
- `tools/hyperframes/kits/ptah-ui/reference/subagents-ask-user-question.png`
- `tools/hyperframes/kits/ptah-ui/reference/three-sessions-composer.png`
- `tools/hyperframes/kits/ptah-ui/src/agent-report-card.html`
- `tools/hyperframes/kits/ptah-ui/src/agents-panel.html`
- `tools/hyperframes/kits/ptah-ui/src/app-window.html`
- `tools/hyperframes/kits/ptah-ui/src/chat-message.html`
- `tools/hyperframes/kits/ptah-ui/src/composer.html`
- `tools/hyperframes/kits/ptah-ui/src/lane-completion-toast.html`
- `tools/hyperframes/kits/ptah-ui/src/partials/base.css`
- `tools/hyperframes/kits/ptah-ui/src/partials/runtime.js`
- `tools/hyperframes/kits/ptah-ui/src/peer-send.html`
- `tools/hyperframes/kits/ptah-ui/src/session-shell.html`
- `tools/hyperframes/kits/ptah-ui/src/subagent-bubble.html`
- `tools/hyperframes/kits/ptah-ui/src/thinking-block.html`
- `tools/hyperframes/kits/ptah-ui/src/tool-call-row.html`
- `tools/hyperframes/projects/agent-lanes-chat/AGENTS.md`
- `tools/hyperframes/projects/agent-lanes-chat/BRIEF.md`
- `tools/hyperframes/projects/agent-lanes-chat/CLAUDE.md`
- `tools/hyperframes/projects/agent-lanes-chat/STORYBOARD.md`
- `tools/hyperframes/projects/agent-lanes-chat/assemble.mjs`
- `tools/hyperframes/projects/agent-lanes-chat/compositions/frames/01-wait.html`
- `tools/hyperframes/projects/agent-lanes-chat/compositions/frames/02-split.html`
- `tools/hyperframes/projects/agent-lanes-chat/compositions/frames/03-parallel.html`
- `tools/hyperframes/projects/agent-lanes-chat/compositions/frames/04-pushed.html`
- `tools/hyperframes/projects/agent-lanes-chat/hyperframes.json`
- `tools/hyperframes/projects/agent-lanes-chat/index.html`
- `tools/hyperframes/projects/agent-lanes-chat/meta.json`
- `tools/hyperframes/projects/agent-lanes-chat/package.json`
- `tools/hyperframes/projects/agent-lanes-chat/src/index.tpl`
- `tools/hyperframes/projects/agent-lanes-explainer/AGENTS.md`
- `tools/hyperframes/projects/agent-lanes-explainer/BRIEF.md`
- `tools/hyperframes/projects/agent-lanes-explainer/CLAUDE.md`
- `tools/hyperframes/projects/agent-lanes-explainer/STORYBOARD.md`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/antigravity.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/claude.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/copilot.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/cursor.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/kimi.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/lmstudio.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/ollama.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/openai.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/opencode.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/openrouter.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/assets/logos/zai.svg`
- `tools/hyperframes/projects/agent-lanes-explainer/hyperframes.json`
- `tools/hyperframes/projects/agent-lanes-explainer/index.html`
- `tools/hyperframes/projects/agent-lanes-explainer/meta.json`
- `tools/hyperframes/projects/agent-lanes-explainer/package.json`
- `tools/hyperframes/projects/agent-lanes-v2/AGENTS.md`
- `tools/hyperframes/projects/agent-lanes-v2/CLAUDE.md`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/antigravity.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/claude.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/copilot.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/cursor.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/kimi.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/lmstudio.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/ollama.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/openai.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/opencode.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/openrouter.svg`
- `tools/hyperframes/projects/agent-lanes-v2/assets/logos/zai.svg`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/assets/hyperframes-logo-dark.svg`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/chromatic-radial-split.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/cinematic-zoom.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/aurora-drift.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/camera-rig-depth-stack.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/code-terminal-run.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/count-up.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/grain-overlay.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/kinetic-type-swap.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/logo-sting.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/notification-stack.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/rgb-glitch-text.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/shimmer-sweep.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/components/zoom-through-transition.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/glitch.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/lib/liquid-glass.iife.js`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/light-leak.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/liquid-glass-notification.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/logo-outro.html`
- `tools/hyperframes/projects/agent-lanes-v2/compositions/whip-pan.html`
- `tools/hyperframes/projects/agent-lanes-v2/hyperframes.json`
- `tools/hyperframes/projects/agent-lanes-v2/hyperframes.lock.json`
- `tools/hyperframes/projects/agent-lanes-v2/index.html`
- `tools/hyperframes/projects/agent-lanes-v2/meta.json`
- `tools/hyperframes/projects/agent-lanes-v2/package.json`
- `tools/hyperframes/projects/agent-lanes-v3/AGENTS.md`
- `tools/hyperframes/projects/agent-lanes-v3/BRIEF.md`
- `tools/hyperframes/projects/agent-lanes-v3/CLAUDE.md`
- `tools/hyperframes/projects/agent-lanes-v3/STORYBOARD-v1.md`
- `tools/hyperframes/projects/agent-lanes-v3/STORYBOARD.md`
- `tools/hyperframes/projects/agent-lanes-v3/assemble.mjs`
- `tools/hyperframes/projects/agent-lanes-v3/compositions/frames/01-wait.html`
- `tools/hyperframes/projects/agent-lanes-v3/compositions/frames/02-split.html`
- `tools/hyperframes/projects/agent-lanes-v3/compositions/frames/03-parallel.html`
- `tools/hyperframes/projects/agent-lanes-v3/compositions/frames/04-pushed.html`
- `tools/hyperframes/projects/agent-lanes-v3/hyperframes.json`
- `tools/hyperframes/projects/agent-lanes-v3/index.html`
- `tools/hyperframes/projects/agent-lanes-v3/meta.json`
- `tools/hyperframes/projects/agent-lanes-v3/package.json`
- `tools/hyperframes/projects/agent-lanes-v3/src/index.tpl`
- `tools/hyperframes/projects/agent-lanes-v3/storyboard.html`
- `tools/hyperframes/projects/agentic-factory-promo/AGENTS.md`
- `tools/hyperframes/projects/agentic-factory-promo/BRIEF.md`
- `tools/hyperframes/projects/agentic-factory-promo/CLAUDE.md`
- `tools/hyperframes/projects/agentic-factory-promo/STORYBOARD.md`
- `tools/hyperframes/projects/agentic-factory-promo/hyperframes.json`
- `tools/hyperframes/projects/agentic-factory-promo/index.html`
- `tools/hyperframes/projects/agentic-factory-promo/meta.json`
- `tools/hyperframes/projects/agentic-factory-promo/package.json`
- `tools/hyperframes/render.mjs`

### `libs/showcase-manifest/` ? 6 files (MOVE-AS-SOURCE)

- `libs/showcase-manifest/package.json`
- `libs/showcase-manifest/project.json`
- `libs/showcase-manifest/src/index.ts`
- `libs/showcase-manifest/src/lib/manifest.types.ts`
- `libs/showcase-manifest/tsconfig.json`
- `libs/showcase-manifest/tsconfig.lib.json`

### `plugins/ptah-video/` ? 6 files (MOVE-AS-SOURCE)

- `plugins/ptah-video/.claude-plugin/plugin.json`
- `plugins/ptah-video/skills/video-showcase/SKILL.md`
- `plugins/ptah-video/skills/video-showcase/reference/brand-and-runtime.md`
- `plugins/ptah-video/skills/video-showcase/reference/camera-and-render.md`
- `plugins/ptah-video/skills/video-showcase/reference/install.md`
- `plugins/ptah-video/skills/video-showcase/reference/scene-authoring.md`

### `.claude/skills/video-showcase/` ? 5 files (MOVE-AS-SOURCE)

- `.claude/skills/video-showcase/SKILL.md`
- `.claude/skills/video-showcase/reference/brand-and-runtime.md`
- `.claude/skills/video-showcase/reference/camera-and-render.md`
- `.claude/skills/video-showcase/reference/install.md`
- `.claude/skills/video-showcase/reference/scene-authoring.md`

### `docs/video-scripts/` ? 18 files (MOVE-AS-SOURCE)

- `docs/video-scripts/AEC-harness-ifc-autodesk.md`
- `docs/video-scripts/E00-setup-and-thesis.md`
- `docs/video-scripts/E01-idea-to-roadmap.md`
- `docs/video-scripts/E02-scaffold-workspace.md`
- `docs/video-scripts/E03-domain-ddd.md`
- `docs/video-scripts/E04-auth-multitenancy.md`
- `docs/video-scripts/E05-tasks-engine.md`
- `docs/video-scripts/E06-monetize.md`
- `docs/video-scripts/E07-frontend.md`
- `docs/video-scripts/E08-triple-review.md`
- `docs/video-scripts/E09-always-on-ops.md`
- `docs/video-scripts/E10-ship-it.md`
- `docs/video-scripts/E11-teach-ptah.md`
- `docs/video-scripts/E12-finale.md`
- `docs/video-scripts/HEADLINES.md`
- `docs/video-scripts/SCRIPT-STYLE-GUIDE.md`
- `docs/video-scripts/sales-harness-apollo-hubspot-zernio.md`
- `docs/video-scripts/video-studio-extraction.md`

### `apps/ptah-electron-e2e/src/showcase/` ? 31 files (MOVE-AS-SOURCE)

- `apps/ptah-electron-e2e/src/showcase/_harness/browser-fixtures.ts`
- `apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts`
- `apps/ptah-electron-e2e/src/showcase/_harness/director.ts`
- `apps/ptah-electron-e2e/src/showcase/_harness/prewarm.ts`
- `apps/ptah-electron-e2e/src/showcase/_harness/showcase-fixtures.ts`
- `apps/ptah-electron-e2e/src/showcase/_harness/showcase-launcher.ts`
- `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/cron-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/gateway-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/landing-page-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/marketplace-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/memory-recall.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/scripts/canvas-orchestra.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/chat-code-edit.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/cron-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/dashboard-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/gateway-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/landing-page-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/marketplace-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/memory-recall.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/settings-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/setup-wizard-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/skills-tour.json`
- `apps/ptah-electron-e2e/src/showcase/scripts/thoth-tour.json`
- `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/setup-wizard-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/skills-tour.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/thoth-tour.scene.ts`

### Standalone tracked video files

- `.claude/agents/video-director.md`
- `.claude/skills/technical-content-writer/VIDEO-SCRIPTS.md`
- `.codex/agents/video-director.toml`
- `.github/workflows/render-showcase.yml`
- `.github/workflows/upload-recordings.yml`
- `.opencode/agent/video-director.md`
- `apps/ptah-electron-e2e/scripts/clean-recordings.mjs`
- `apps/ptah-electron-e2e/scripts/transcode.mjs`
- `apps/ptah-electron-e2e/showcase.config.ts`
- `docs/video-series-saas-on-open-weights.md`
- `libs/backend/agent-generation/templates/agents/video-director.template.md`
- `plugins/ptah-core/skills/technical-content-writer/VIDEO-SCRIPTS.md`

### Finished docs video assets ? 8 tracked files (SPLIT; Ptah-specific)

- `apps/ptah-docs/public/assets/videos/auth.mp4`
- `apps/ptah-docs/public/assets/videos/cli-agent-orchestration.mp4`
- `apps/ptah-docs/public/assets/videos/install.mp4`
- `apps/ptah-docs/public/assets/videos/plugins.mp4`
- `apps/ptah-docs/public/assets/videos/providers.mp4`
- `apps/ptah-docs/public/assets/videos/ptah-mcp-server.mp4`
- `apps/ptah-docs/public/assets/videos/setup-wizard-agent-generation.mp4`
- `apps/ptah-docs/public/assets/videos/setup-wizard-analysis.mp4`
