## Files

- Edited `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts`: removed the Tribunal tab beat and shifted narration indices.
- Edited `apps/ptah-electron-e2e/src/showcase/scripts/dashboard-tour.json`: removed the Tribunal narration line.
- Edited `apps/ptah-electron-e2e/src/support/ui-driver.ts`: removed the Tribunal view and host selector.
- Deleted `apps/ptah-electron-e2e/src/showcase/tribunal-tour.scene.ts`.
- Deleted `apps/ptah-electron-e2e/src/showcase/scripts/tribunal-tour.json`.
- Deleted `apps/ptah-electron-e2e/src/specs/tribunal/tribunal.spec.ts`.
- Edited `apps/ptah-docs/src/content/docs/tribunal/index.mdx`: chat-first skill overview.
- Edited `apps/ptah-docs/src/content/docs/tribunal/council.md`: chat request, panel, confirmation, verdict, stop.
- Edited `apps/ptah-docs/src/content/docs/tribunal/forge.md`: chat request, isolated implementations, review, stop.
- Edited `apps/ptah-docs/src/content/docs/tribunal/race.md`: chat request, fixed rubric, verification, stop.
- Edited `apps/ptah-docs/src/content/docs/tribunal/crucible.md`: chat request, executor and judge, rubric, stop.
- Edited `apps/ptah-docs/src/content/docs/tribunal/relay.md`: chat request, orchestration phases, artifacts, stop.
- Edited `apps/ptah-docs/src/content/docs/agents/agent-orchestration.md`: Relay launch wording.
- Edited `apps/ptah-docs/src/content/docs/agents/index.mdx`: Relay launch wording.
- Edited `apps/ptah-docs/src/content/docs/getting-started/first-launch.md`: removed the retired tab from the tab bar.
- Edited `apps/ptah-docs/src/content/docs/index.mdx`: Tribunal link card describes the skill.
- Edited `apps/ptah-docs/src/content/docs/setup/index.md`: removed the Setup Hub Tribunal card and linked to the chat skill.
- Edited `README.md`: Tribunal skill description and Setup Hub image caption.
- Edited `apps/ptah-video-studio/FOLLOW-UP.md`: removed the retired tour from future recapture instructions.
- Edited `apps/ptah-video-studio/docs/feature-knowledge-base.md`: skill and five workflows in chat.
- Edited `tools/hyperframes/kits/ptah-ui/SPEC.md`: removed the mock Tribunal navbar tab.
- Edited `tools/hyperframes/kits/ptah-ui/src/app-window.html`: removed the mock Tribunal tab option and icon.
- Wrote `.ptah/specs/TASK_2026_852_e271/batch-E-report.md`: this report.

## Docs story

Tribunal is requested through the `tribunal` skill in the main chat.
Users can name installed CLI lanes in plain text or ask the conductor to select a diverse panel from `ptah_agent_list`.
The conductor repeats the pinned panel, rounds, and estimated paid call count before asking for confirmation.
Council debates a question; Forge cross-reviews implementations; Race verifies a rubric winner.
Crucible uses an independent executor and judge; Relay routes an all-lane pipeline through orchestration.
Progress, evidence, and verdicts return in chat, with artifacts in `.ptah/specs/TASK_*`.
Users stop an active run through chat; the conductor stops live lanes with `ptah_agent_stop`.
The established `/tribunal/` URLs remain in place.

## Verification

- `apps/ptah-electron-e2e/project.json` confirms project name `ptah-electron-e2e` and a `typecheck` target.
- `npm run verify -- -t typecheck,lint -p ptah-electron-e2e --parallel=1`: wrapper rejected unknown option `--parallel` before Nx.
- `npm run verify -- -t typecheck,lint -p ptah-electron-e2e`: started, then queued behind other lanes by the repository's shared verify lock. No Nx result was available before handoff.
- `git grep -n -i "tribunal tab\|tribunal page\|tribunal wizard\|tribunal-conductor\|Tribunal Conductor" -- apps/ptah-docs README.md`: no hits.
- Changed internal docs routes resolve to existing Markdown/MDX files. Three linked screenshot paths resolve under `apps/ptah-docs/public`.
- `git diff --check` for touched allowed paths: passed.
- Search of current e2e source and the mock app window found no remaining Tribunal scene, page selector, or tab reference. Showcase discovery is file based; no scene registry entry needed removal.

## Decisions

- Kept `content-manifest.json` Tribunal entries because they list the still-current skill and references.
- Kept the Astro sidebar's Tribunal label and routes because it labels documentation, not a product tab.
- Kept accurate provider and skill mentions in other docs pages; they do not describe the retired entry point.
- Left recorded videos and `beats.json` assets intact.
- Left the landing Council demo implementation intact because its staged visual needs a separate design decision.

## Open issues

- The required e2e typecheck and lint command remains queued on the shared verify lock; its result still needs to be collected after the other lanes' checks finish.
- The landing hero still stages a Council panel inside a device frame titled "Ptah — Tribunal · Council". It may look like the removed page; redesigning that illustration was outside this text cleanup.
- The existing Setup Hub screenshot may still show the retired Tribunal card. Its alt text is updated, but the image was not edited.
