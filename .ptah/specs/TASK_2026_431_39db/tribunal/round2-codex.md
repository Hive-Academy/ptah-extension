## Strongest point — which answer is most convincing, and why

**A is most convincing overall:** consolidate transport mechanics while keeping Tribunal and orchestration separate. B contributes two verified template defects, but its headline savings conflate bundled assets with loaded context.

My earlier answer correctly distinguished loading paths, but overstated some measurements and proposed a shared reference without checking installation boundaries.

## Flaws — concrete errors, unsupported or wrong claims, missed items

Paths below: **P** = `apps/ptah-extension-vscode/assets/plugins`; **O/T** = `P/ptah-core/skills/orchestration/tribunal`; **A** = `libs/backend/agent-generation/templates/agents`; **H** = `libs/backend/harness-sync/src/lib`.

- **B: “98.8 KB of orphan compiled components” is wrong.** These are 11 TypeScript starter templates totaling **98,852 bytes**, explicitly linked by both Angular skills. They may be read for a selected implementation; they are not automatically injected merely because they ship. Deleting them guarantees **zero trigger-context savings**, and replacing complete starters with five-line snippets is not demonstrably capability-preserving.
- **A/B: catalog profiles are not entirely duplicate dispatcher descriptions.** `O/references/agent-catalog.md:398` contains a six-viewport checklist absent from the visual-reviewer description. Decide whether such requirements remain valid, then relocate them before deleting profiles. Some are stale or stack-specific: `:384` assumes `nx build web`.
- **B: the delegation reference and catalog say subtly different things.** The catalog says these agents should not delegate; `cli-agent-delegation.md:493` excludes their *tasks* from CLI execution. The catalog/template contradiction is real, but those statements should not be treated as identical prohibitions.
- **A: do not copy the current CLI partial byte-for-byte into another prompt.** `A/_shared/cli-delegation.md:13` unconditionally demands resume; `T/references/vendor-panel.md:96` correctly handles adapters without session IDs. Resolve semantics before standardizing.
- **B: tooling fallback already exists**, at `A/_shared/tooling-precedence.md:19`. An availability-first instruction would improve it, but fallback is not missing.
- **My earlier answer:** orchestration is currently **24.36 KiB**, not 20.4 KiB. My whitespace estimate belongs in distribution accounting, not the top context-saving recommendation. Aggregate template savings also do not equal savings on each spawn.
- **All answers:** line ceilings and “never teach concepts” are useful prompts for review, not universal laws. Preserve unfamiliar library contracts, failure cases, parser-sensitive labels, and essential reminders in independently loaded agents.

## Verified facts — the claims you checked, TRUE/FALSE with file:line

| Claim | Verification |
|---|---|
| Angular assets automatically consume approximately 24,700 tokens | **FALSE.** Starter selection is explicit: `P/ptah-angular/skills/angular-gsap-animation-crafter/SKILL.md:480` and `angular-3d-scene-crafter/SKILL.md:560`. Discovery injects names/descriptions, not asset contents: [plugin-skill-discovery.ts](/D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts:78). Selected assets can subsequently enter context through reads. |
| Both restricted roles receive CLI delegation permission | **TRUE.** `A/visual-reviewer.template.md:36`, `A/ui-ux-designer.template.md:39`; permission at `A/_shared/cli-delegation.md:3`; conflicting catalog prohibition at `O/references/agent-catalog.md:33`. |
| Every specialist receives ID-allocation instructions | **TRUE.** All 15 templates contain `STATIC:TASK_SPEC_CONTRACT`; resolver maps it to the renderer at `libs/backend/agent-generation/src/lib/services/template-partial-resolver.ts:74`. [task-spec.contract.ts](/D:/projects/ptah-extension/libs/shared/src/lib/types/task-spec.contract.ts:527) explicitly prescribes fetch, tree/worktree scans, numbering and exclusive mkdir. |
| Harness rewrites break ordinary cross-skill relative links | **FALSE for the inspected sync implementation.** `H/targets/workspace-target.ts:352` preserves sibling slugs; `copy-engine.ts:130` preserves nested directories; [skill-transform.ts](/D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/skill-transform.ts:114) changes frontmatter, not body links. Claude copies directly. |
| Co-shipping guarantees both linked skills are installed | **FALSE.** `H/manifest/harness-manifest.builder.ts:246` documents individual skill disabling. A loose shared directory without `SKILL.md` is not discovered (`:375`, `:400`). |

## Revise? — final position: top 5 ranked actions (with KB estimate)

Estimates are editorial **KiB**, not measured tokens; reference savings apply only when loaded.

1. **Correct and slim shared template contracts:** restrict allocation/status mutation by role, remove conflicting delegation grants, fix conditional resume. **8–13 KiB aggregate across expanded agents.**
2. **Reduce orchestration’s entry prompt to routing, gates and boundaries:** **16–18 KiB per trigger**, offset by whichever references are needed.
3. **Move Angular workflow tutorials and scripted dialogues behind selective references:** **25–29 KiB combined entry savings**; retain useful assets.
4. **Consolidate transport repetition:** **10–15 KiB across references**, excluding entry savings counted above.
5. **Compress catalog profiles and team-leader return schemas:** **14–20 KiB combined reference/spawn savings**, after preserving unique contracts.

**Final SSOT decision:** use the existing `orchestration/references/cli-agent-delegation.md`, narrowed to shared transport, rather than introducing an uninstalled sibling reference directory. Tribunal retains panel policy and move protocols. Relative links survive sync **when both skills exist**; installation must ensure that dependency or distribute a generated local copy from the same authored source. Keep specialist boundary reminders self-contained.