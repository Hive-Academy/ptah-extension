# TASK_2026_250 — context

## Where this came from

Found 2026-08-16 while re-evaluating the open-bug list after TASK_2026_249. It
is not on any existing carrier. It was initially called a straightforward
survival of the TASK_2026_159 defect; reading the lane contract showed that
description was too strong, and the correction is the useful part of this file.

## The code

`libs/backend/skill-synthesis/src/lib/model-resolver.ts:20-35`

```ts
export function resolveJudgeModel(judgeModel: string, workspaceProvider: IWorkspaceProvider): string {
  if (judgeModel !== 'inherit') return judgeModel;
  try {
    const configured = workspaceProvider.getConfiguration<string>('ptah', 'llm.vscode.model', '');
    return configured || JUDGE_DEFAULT_MODEL_ID; // <- pinned dated Claude id
  } catch {
    return JUDGE_DEFAULT_MODEL_ID;
  }
}
```

`JUDGE_DEFAULT_MODEL_ID = 'claude-haiku-4-5-20251001'` (`types.ts:9`).

## Why it looks like a defect

TASK_2026_159 removed this exact shape from the memory curator. The replacement
is a **bare tier alias**, and the spec name states the rule outright:

- `sdk-internal-query.curator-llm.ts:61` — `CURATOR_DEFAULT_MODEL_TIER = 'haiku'`
- `sdk-internal-query.curator-llm.ts:50` — comments the old value as
  "a pinned Claude id (`claude-haiku-4-5-...`, what this constant used to be)"
- `sdk-internal-query.curator-llm.spec.ts:139` — _"sends the bare haiku TIER
  ALIAS — not a pinned Claude id — when unset"_

`resolveLaneModel` has already absorbed that lesson on one of its two branches
(`lane-resolver.service.ts:81-89`):

```ts
if (cfg.model.trim()) return cfg.model.trim();
if (!cfg.provider.trim()) return resolveJudgeModel(judgeModel, ws); // pinned id
return cfg.defaultTier; // bare alias
```

and its docblock at `:76-79` gives the reason in the function's own words:

> A bare alias resolves through both `ANTHROPIC_DEFAULT_<TIER>_MODEL` and the
> provider entry's `defaultTiers`, whereas a pinned dated Claude id reaches a
> non-Anthropic endpoint verbatim and 404s.

So the file states the hazard and then routes its default case into it. Every
lane ships `provider: ''` (`SKILL_LANE_DEFAULTS`), so **inherit is the path an
untouched install takes**. A user who moved their main provider to Z.AI,
Moonshot or Ollama Cloud and never opened the lane settings gets
`claude-haiku-4-5-20251001` sent at an endpoint that cannot serve it.

## Why it was NOT fixed on sight

Three things say the current behaviour is deliberate:

1. **`skill-synthesis/CLAUDE.md` calls it a guarantee.** Its lane-resolution
   rule describes the inherit branch as _"byte-identical to today's call, which
   is the untouched-existing-installs guarantee"_.
2. **A spec pins it by name.** `lane-resolver.service.spec.ts:116` —
   `expect(out.ok && out.lane.model).toBe(JUDGE_DEFAULT_MODEL_ID)`, under the
   title _"falls to the shipped judge default when the workspace pins no
   model"_.
3. **The library is under active concurrent edit** by TASK_2026_180, which owns
   the lane contract and wrote all three of the above.

Changing it means overturning a documented decision made by the session that
owns the lib, in files it is editing right now. That is a handover, not a
drive-by.

## What the fix would be

One line, mirroring the curator: fall back to a bare tier alias rather than a
pinned id, and update the spec that names the old behaviour.

```ts
return configured || JUDGE_DEFAULT_MODEL_TIER; // 'haiku'
```

`JUDGE_DEFAULT_MODEL_ID` is exported from the lib barrel (`src/index.ts:394`),
so check consumers before deleting it outright — deprecating it in place beside
a new tier constant is the smaller change.

## The question that decides this

Does "inherit" mean _inherit the workspace-pinned model, else ship a known-good
Anthropic model_, or _inherit whatever the active provider resolves for this
tier_? The curator has already answered it the second way. If the judge lane
answers it the first way on purpose, then the CLAUDE.md rule should say so as a
CHOICE with its reason, because the sentence next to it currently argues
against pinned ids.

## Verification when it is taken

- Assert the resolved model is a bare alias, not a dated id, when nothing is
  configured — mirror `sdk-internal-query.curator-llm.spec.ts:139`.
- Assert the workspace-pinned path is unchanged
  (`lane-resolver.service.spec.ts:105-110` already covers it).
- `nx run-many -t test lint typecheck -p skill-synthesis agent-sdk`.

## Suggested executor

Whoever holds TASK_2026_180 — same files, same contract.

---

## Decided 2026-08-16 — the question above is now answered

TASK_2026_180 closed `done` (40/40, `5201dcd71`), so reason 3 for not fixing on
sight — the lib being under concurrent edit by the session that owns the lane
contract — no longer holds. The handover is available. Two decisions were taken
at the orchestration scope checkpoint.

### Decision 1 — "inherit" keeps the pinned id, ON PURPOSE

The nothing-configured fallback stays `JUDGE_DEFAULT_MODEL_ID`. Inherit means
_inherit the workspace-pinned model, else ship a known-good Anthropic model_ —
the FIRST reading in "The question that decides this", not the curator's.

**This is a divergence from TASK_2026_159 and it is deliberate.** It is therefore
not enough to leave the code alone: `skill-synthesis/CLAUDE.md`'s lane-resolution
rule currently justifies the branch as _"byte-identical to today's call, which is
the untouched-existing-installs guarantee"_ and then, one clause later, argues
that a pinned dated Claude id 404s off-Anthropic. A reader cannot tell from that
which half is the intent. The rule must state the pinned default as a CHOICE
carrying its own reason, so the next person who finds this stops rather than
re-filing it. `model-resolver.ts`'s docblock describes the mechanism and not the
reason, and has the same problem.

`lane-resolver.service.spec.ts:116` and the `JUDGE_DEFAULT_MODEL_ID` constant
both stay as they are. The one-line change proposed in "What the fix would be"
above is NOT taken.

### Decision 2 — the `llm.vscode.model` read IS in scope

Found at the checkpoint, not on the carrier. The inherit branch reads
`ptah.llm.vscode.model` — a VS Code Language Model key whose shipped example
value is `copilot/gpt-4o` (`platform-core/src/file-settings-keys.ts:386`).
Nothing on this path reads the user's active chat provider or model, so the
branch has two outcomes and the carrier only described the second:

- key set → a `copilot/…`-shaped id is sent to the lane's endpoint
- key unset → the pinned `claude-haiku-4-5-20251001`

That is the SAME defect the carrier describes, one layer up: a model id from one
provider family handed to another family's endpoint. Fixing only the fallback
would leave the function correct exactly when the key is unset. Under Decision 1
the unset case is now correct by definition, which leaves this read as the whole
of the remaining defect.

Constraint on the fix: the nothing-configured result must remain
`JUDGE_DEFAULT_MODEL_ID`. What the configured case should read instead is an
implementation decision for the executor, to be justified in the report.

### Blast radius

`JUDGE_DEFAULT_MODEL_ID` has one production consumer (`model-resolver.ts:31,33`),
one spec reference (`lane-resolver.service.spec.ts:116`), and a barrel export at
`src/index.ts:394` with no importer outside the lib.
