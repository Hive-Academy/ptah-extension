# P4 code-logic review — Batch 26: generation prompt rubric alignment

Review family: Ollama Cloud (Glm), implementer Claude.

Scope: the 7-file working-tree diff (p4-batch26.patch), the four new/modified
source files under `libs/backend/agent-generation/src/lib/services/`, the pinned
spec, and the rubric file. Read-only review; no source edits, no git state
changes, no builds. Independent verification done: all 12 pinned sha256 hashes
(6 rubric bodies + 6 instructions) were recomputed against the current rubric
file — all match.

## Score: 6/10

The gate's three no-block conditions, the fail-closed policy read and the
pinned agreement are correct and tested. One Serious defect sits in the exact
capability the batch delivers: the disabled-skill filter compares ids from two
different domains, so exclusion silently fails for any skill whose frontmatter
name differs from its directory. Two disclosed gaps (CI enforcement reach,
policy scope) keep the guarantee from holding end to end. What separates this
from 7-8 (sound): the Serious finding is in the delivered gate itself, it is
not disclosed by the implementer (their decision assumed the two id domains are
equal), and the batch's own tests cannot catch it. What separates it from 3-4:
everything else works, is independently verified, and the failure is local to
one filter line plus one plumbing assumption.

## Findings

1. **Serious — the disabled-skill filter matches the wrong id domain.**
   `libs/backend/agent-generation/src/lib/services/invocable-plugin-skills.ts:42`
   filters with `disabled.has(skill.skillName)`, and `skillName` is the
   frontmatter `name` field
   (`libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts:62`).
   But `disabledSkillIds` holds directory ids: the save handler validates them
   against `skillId`, which is the directory name
   (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:431-432`,
   `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1746`), and
   the loader decides runtime invocability by the same directory id
   (`plugin-loader.service.ts:1754`). Failure scenario: plugin `acme` ships
   skill directory `code-review` whose `SKILL.md` says `name: Acme Code Review`.
   The user disables it in the Plugins panel; id `code-review` is stored and the
   loader marks it `not-invocable`. The wizard then generates a
   `backend-developer` agent: the gate reads `disabledSkillIds` =
   `['code-review']`, `discoverPluginSkills` returns `skillName` =
   `Acme Code Review`, the filter keeps it, and the prompt lists it under a
   block that asserts "every skill listed here is one this agent may invoke" —
   a false claim at runtime. The inverse also happens: a skill whose frontmatter
   name equals another skill's directory id is excluded although nothing
   disabled it. Reach today: all 16 repo-shipped skills have `name` equal to the
   directory, so shipped content behaves; third-party and marketplace skills
   have no such constraint, and plugins are third-party by design. The batch's
   fixtures (`invocable-plugin-skills.spec.ts:32-35`) use skillName == id, so
   the tests pass while the id domains differ. The implementer's decision table
   records the assumption ("Ptah skills use name = directory") but no code
   enforces it. Fix direction: gate on the directory id (the loader's
   `discoverSkillsForPlugins` returns `skillId`; or extend `PluginSkillInfo`).

2. **Moderate — CI does not run the pinned spec on a rubric-only edit.**
   `.claude/` belongs to no Nx project, so a PR that edits only
   `.claude/skills/skill-creator/references/prompt-authoring-rubric.md` does
   not mark `agent-generation` affected; `nx affected` in PR CI skips the test
   that the batch exists to enforce (`generation-prompt-rules.spec.ts`). The
   spec does fail when it runs — the implementer's verification run proves it,
   and my hash recomputation confirms both sides currently agree — but the
   trigger has a hole: a rubric-only change can merge with the agreement
   broken, and it is caught only by the nightly `run-many --all` or by any PR
   that happens to touch `agent-generation`. Disclosed by the implementer as
   open issue 1 with a concrete fix (add the rubric file to the test target
   `inputs` in `libs/backend/agent-generation/project.json`). It stays a
   finding because requirement 2 asks for an enforced two-sided agreement, and
   the enforcement path is the part that is missing.

3. **Moderate — absent workspace storage reads as "nothing disabled", not as
   unknown (open issue 3 confirmed).** The gate reads the policy for
   `context.rootPath`
   (`content-generation.service.ts:568`, `:595`) while the handler resolves
   `pluginPaths` from the active workspace's config. For a root the host has
   no storage for, `readWorkspaceLayer` returns
   `{ status: 'ok', config: emptyPluginConfig() }` — the empty default, not an
   error (`plugin-loader.service.ts:1060-1062`). So the disabled list silently
   reads as empty: a skill the user switched off at workspace level in the
   active workspace is still advertised when generating for a storage-less
   root. Only an unreadable layer throws (`CapabilityPolicyUnknownError`,
   `plugin-loader.service.ts:1111-1134`) and is handled fail-closed. Severity
   is Moderate, not higher, because the primary wizard flow keeps
   `rootPath` equal to the active workspace (scopes agree), and the generated
   agent runs under the target root's own policy, so the "may invoke" claim
   stays true under that root's policy — the leak is against the user's
   active-workspace intent, and the `pluginPaths` scope half of the mismatch
   is pre-existing plumbing outside this batch.

4. **Minor — an absent policy reader is visible only at debug level.** When
   `SDK_PLUGIN_LOADER` is not registered, the optional injection yields null
   (`content-generation.service.ts:194`), `readDisabledSkillIds` returns null
   with no log of its own (`:592`), and the only trace is the debug line at
   `:575` (`policyKnown: false`). On a host that skips the standard SDK
   registration (the token is registered unconditionally in
   `libs/backend/agent-sdk/src/lib/di/register.ts:858-862`, so standard hosts
   are covered), plugin-skill guidance silently vanishes from every generated
   agent with no warn. The behavior is the required fail-closed one; only the
   visibility is thin.

5. **Minor — the gate's discovery call can abort a whole generation on one
   unreadable SKILL.md (pre-existing, moved call site).**
   `discoverPluginSkills` reads `SKILL.md` with an unwrapped `readFileSync`
   (`plugin-skill-discovery.ts:57`), so one unreadable file throws out of
   `resolveInvocablePluginSkills` (`content-generation.service.ts:566`) and the
   whole template falls back to authored content. The loader's own scan wraps
   this exact read because half-written skill folders are plausible at wizard
   time (`plugin-loader.service.ts:1734-1741`). Not introduced by this batch —
   the call moved from the prompt builder into the new method with the same
   behavior — but the batch owns this line now.

## Requested checks

**(a) Unreadable/throwing policy → no block, logged?** Yes. Any throw from
`getEffectivePluginConfig` — including `CapabilityPolicyUnknownError`, which the
loader throws by design for unreadable layers — is caught at
`content-generation.service.ts:597-608`, logged as a warn ("Skill policy
unreadable; no plugin skill is listed in the generation prompt") with
`rootPath` and the error message, and answered as null; the gate then returns
`[]` and no block is appended (`:407-416`). The property access
`effective.config.disabledSkillIds` sits inside the same try, so a malformed
config shape also lands in the catch, not in a crash. Tested with a rejecting
mock (`content-generation.service.spec.ts:2477`). The absent-loader half of the
check is silent at warn level — finding 4.

**(b) Issue 3 severity.** It is a real path, confirmed in code (finding 3): a
storage-less root gets the empty policy as a known answer, so a skill disabled
in the active workspace can be offered for that root. Moderate: the standard
flow keeps the two scopes equal, the failure needs a user-disabled skill plus
a root without storage, and the half of the mismatch that supplies the skills
(`pluginPaths` from the active workspace) is pre-existing and outside the
batch.

**(c) Optional DI on hosts without the loader.** Unregistered token → null →
`readDisabledSkillIds` returns null → no plugin-skill block, generation
proceeds and the rest of the prompt is unaffected. That is the required
conservative answer. Standard hosts always register the token
(`register.ts:858-862`), so the exposure is embedders only, with debug-level
visibility (finding 4).

**(d) Do the removed FORBIDDEN bullets lose a rule?** No. Counts → "no counts
of anything"; version numbers → "no version numbers (name the framework,
never its version)"; inventories → "no inventory of the directory tree, the lib
set or the dependency list" (`generation-prompt-rules.ts:55-56`). Each removed
ban survives verbatim or as a superset; only the example strings ("15 libs")
are gone. The head clause "the agent can discover" qualifies the lead-in, but
the colon expansion restates each ban unconditionally, and the rubric's own
rule 7 is likewise discoverability-qualified, so this matches the one-home
semantics. The kept FORBIDDEN bullets (percentages, coverage figures, tallies;
dates) are not rule-7 duplicates — dates overlap rule 5, but the plan only
required removing rule-7 duplicates, and the overlap only reinforces.

## Five logic questions

1. **Silent failure:** the disabled filter matching nothing because the two id
   domains differ (finding 1) — the gate runs, reports success, and the
   prompt's invocability claim is false.
2. **User action with unexpected behaviour:** disabling a skill whose display
   name differs from its folder name in the Plugins panel, then generating an
   agent — the skill is still advertised (finding 1).
3. **Input that yields a wrong answer, not an error:** a `SKILL.md` whose
   frontmatter `name` differs from its directory name (finding 1), or a
   workspace with no stored plugin state (finding 3).
4. **Dependency failure/timeout:** an unreadable policy layer throws and is
   handled fail-closed with a warn (check a). A hanging `getEffectivePluginConfig`
   would stall generation before the timeout budget arms (`:419`), but it
   performs two in-process reads and follows the same pre-execute pattern as
   `resolveAnalysisData` (`:336`), so no new risk class was added.
5. **Missing from the requirements:** the CI trigger that makes the pinned
   agreement binding on the PR path (finding 2), and the id-domain contract
   between discovery and the disabled policy (finding 1) — the requirement
   says "disabled skills" without naming the id, and the plan's A-dis route
   would have kept policy scope and discovery scope in one config home.

## Requirements check

1. **Rules module with RUBRIC RULES block, every instruction verbatim — MET.**
   `generation-prompt-rules.ts:28-64` (rules 2, 3, 5, 6, 7, 8) and
   `formatRubricRulesBlock()` at `:67-71`; inserted into the system prompt at
   `content-generation.service.ts:398`; asserted per instruction by
   `content-generation.service.spec.ts:2416-2427`.
2. **Hand-written pinned table that fails on either side alone — MET, with a
   CI-reach hole.** `generation-prompt-rules.spec.ts:22-76` imports nothing
   from the module; the rubric is read from the repo root; all 12 hashes
   recomputed independently and match the current rubric. A rubric-only edit
   fails the body test and a prompt-only edit fails the instruction test when
   the spec runs — but PR CI does not run it on rubric-only edits (finding 2).
3. **Gate: unknown type, `Skill` disallowed, unknown policy → no block;
   disabled excluded — PARTIALLY MET.** The three no-block conditions hold
   (`invocable-plugin-skills.ts:36-40`, tested in both specs). Disabled
   exclusion works only while frontmatter name equals directory id
   (finding 1).
4. **Representative 6.7 case with limits — MET.**
   `content-generation.service.spec.ts:2518-2562`: cases (a), (b), (c) with
   the real `GeneratedSectionValidator`, a fixture type that denies `Skill`
   via a spec-only allowlist mock, a control case proving the stub detects a
   mention, and a doc comment stating the limits (no proof against an
   inventing model; no output filter; validator unchanged).
5. **No `TASK_\d{4}_\d+` or dates in generated output — MET as specified.**
   `content-generation.service.spec.ts:2567-2582` over representative stubbed
   output, plus the rules block itself
   (`generation-prompt-rules.spec.ts`, "carries no task id or date"). The
   check's power is bounded by the stub, which is what the plan specified.
6. **`generated-section-validator` specs unchanged — MET.** The working-tree
   diff contains only the 7 batch files; no validator file appears among the
   modified or new paths.

## Verdict

Verdict: REVISE