# TASK_2026_265 — context

## Where this came from

Flagged during TASK_2026_262 as a follow-up and deliberately NOT folded into it.
Surfaced to the user 2026-08-17 alongside a second item; the user challenged
both ("why you considered those as bugs?"), which was the right call — one of
the two did not survive the challenge and is recorded below as dropped.

## What is actually wrong

`ProviderModelsService.autoResolveDefaultTiers` (`provider-models.service.ts:530-564`):

```ts
// :412 — the call site, inside the generic fetch path, for ANY providerId
await this.autoResolveDefaultTiers(providerId, models);

// :556 — persists through the public setter
await this.setModelTier(providerId, tier, modelId, 'mainAgent');

// :507-512 — setModelTier, no activeness check
await this.config.set(configKey, modelId);
if (scope === 'mainAgent') {
  this.authEnv[envVar] = modelId;
  process.env[envVar] = modelId; // ← GLOBAL
  this.applyTierMetadata(providerId, tier, modelId);
}
```

### Defect 1 — precedence violation (confirmed by reading, low ambiguity)

`setModelTier` writes `provider.<id>.mainAgent.modelTier.<tier>`. That is the
exact key `getPersistedTierValue` reads, and per the precedence contract
`user pick ?? registry defaultTiers ?? live-derived` it is the TOP link. So a
regex guess is stored as though the user had chosen it.

Consequences, in order of how much they cost:

1. The guess outranks a `defaultTiers` map the registry may gain later — a
   verified statement by whoever added the registry entry loses to a heuristic.
2. Nothing downstream can tell "we guessed this" from "the user chose this", so
   there is no safe way to ever re-derive it.
3. A persisted guess is permanent. The read-time rule TASK_2026_262 added
   (`deriveTiersFromCatalog`) re-derives whenever the catalogue changes; this
   one freezes whatever the catalogue said the first time it was fetched.

Already recorded in `libs/backend/auth-providers/CLAUDE.md` under "Precedence,
and the one thing that violates it" as a **known violation, not introduced by
262**, with deletion in favour of the read-time rule named as the recommended
fix. This task does not need to re-derive that conclusion — it needs to check
whether deletion is actually safe now (see the gating question).

### Defect 2 — no provider-activeness guard (SUSPECTED, not reproduced)

`:412` runs on every successful fetch for whatever `providerId` was asked for.
`setModelTier` then writes GLOBAL `process.env[ANTHROPIC_DEFAULT_*_MODEL]` and
the shared `authEnv` with no check that `providerId` is the provider the active
session is using.

Hypothesised failure: user is chatting on provider A, opens the model picker for
provider B, B's catalogue is fetched, B has no persisted tiers, B's catalogue
carries `anthropic/claude-*` ids (openrouter and requesty both do) — B's ids land
in the tier env vars A's session resolves through.

Preconditions that must ALL hold:

- the fetch path at `:412` is reachable for a NON-active provider
- that provider has no persisted tier values (`:534-537` guard)
- its catalogue contains ids matching `/claude.*(sonnet|opus|haiku)/i`

**This has not been run.** It was traced by reading `provider:listModels` →
fetch → `:412`. Treat it as a hypothesis to confirm or kill, not a finding.

## The gating question, answered first

**Is deleting `autoResolveDefaultTiers` safe, or does it still cover something
the read-time rule does not?**

`deriveTiersFromCatalog` (added by TASK_2026_262) is consulted lazily by all
three writers via `getLiveDerivedTiers`. If it covers everything
`autoResolveDefaultTiers` was doing, deletion closes both defects at once and is
strictly better — a value that is never persisted cannot be laundered into the
user-choice slot and cannot go stale.

Differences worth checking rather than assuming:

|                     | `autoResolveDefaultTiers`         | `deriveTiersFromCatalog`                         |
| ------------------- | --------------------------------- | ------------------------------------------------ |
| Matching            | `/claude.*(tier)/i` — claude-only | nominal pass on word boundary, provider-agnostic |
| Ordinal fallback    | none                              | context length descending                        |
| Ranking within tier | `.sort().at(-1)` — lexicographic  | n/a                                              |
| Persisted           | yes, user-choice slot             | no, read-time                                    |
| Scope of write      | global env + config               | snapshot / caller-scoped                         |

The lexicographic `.sort().at(-1)` is its own small hazard and should be named
in the report, but it is not the reason this task exists.

## Explicitly NOT in scope

**The `chat-session.service.ts:418` `'default'` substitution.** Raised in the
same breath as the above and it does not belong here — the code is correct and
the only gap is that it is verified by reading rather than by a test. That is
coverage, not a defect. If it gets written up at all it is a line in an existing
carrier, not a task. Recorded here so nobody re-files it as a bug.

## Decision 1 — delete only, no migration (user, 2026-08-17)

Research came back **SAFE-WITH-MIGRATION**: deleting the writer stops new
contamination but leaves every already-persisted guess sitting in the
top-of-precedence key, permanently short-circuiting `deriveTiersFromCatalog`.
No marker exists anywhere to tell a guess from a user pick — grepped for
`isGuessed`/`autoResolved`/`guessedTier`, none.

Three options were put to the user: delete-only, delete + one-time clear of
auto-shaped keys, delete + a UI reset affordance. **Chosen: delete only.**

The reasoning that made it the recommendation, recorded so nobody "fixes" the
residue later without re-reading it:

- The residue is **servable, not broken**. A guess persisted under
  `provider.openrouter.…` is an id from OpenRouter's own catalogue and is only
  read when OpenRouter is active. It costs quality (an arbitrary pick that
  outranks a `defaultTiers` the registry may later gain), not a failing session.
- The **acute** defect is Defect 2, the cross-provider global env write, and
  deletion closes it completely and by construction.
- A one-time clear cannot distinguish a guess from a deliberate pick, so it
  would silently discard real user choices on `openrouter`/`requesty` — writing
  to saved settings with no undo, to fix a quality issue.

**Accepted residual, on purpose:** an install that opened the `openrouter` or
`requesty` model picker before this fix keeps its persisted guess indefinitely
and never reaches the read-time rule for that provider/tier. It self-heals only
if the user sets a tier explicitly. This must be stated in
`libs/backend/auth-providers/CLAUDE.md`, not just here — the existing
"Precedence" paragraph will otherwise read as though the hole is fully closed.

## Out of scope, decided rather than overlooked

**`deriveTiersFromCatalog`'s `byIdAscending`.** Research confirmed it is the
genuinely lexicographic sort (the deleted function's `.sort()` is a no-op — see
below) and that it mis-ranks `4.9` above `4.10` and prefers a `:thinking`
suffixed variant. Both are already named as accepted flaws in that function's
own docblock, and neither is triggered by any shipped catalogue today. Left
alone. Widening this task to chase a latent flaw in the surviving function
would blur what the fix is being judged on.

## Correction to this file's own comparison table

The "Ranking within tier" row above says `autoResolveDefaultTiers` sorts
lexicographically. **It does not.** `.sort()` is called with no comparator on an
array of `ProviderModelInfo` objects, so every element stringifies to
`"[object Object]"`, every comparison returns 0, and a stable sort leaves the
array untouched. `.at(-1)` returns whatever the provider's API happened to list
last. The docblock's claim to pick "the newest Claude model per tier" has never
been true. Table was written from memory; the code is the authority.

## Verification

- The reproduction above either confirmed or explicitly killed, in writing,
  before any fix lands.
- A spec that fails on the current code and passes after — the repo standard.
  If Defect 2 is killed, Defect 1 still needs one, and it is the harder one to
  pin because the damage is a config key that looks legitimate.
- `libs/backend/auth-providers/CLAUDE.md` "Precedence" section updated: it
  currently describes this as a live known violation. If the fix lands, that
  paragraph is wrong and must say so.
- No provider privileged, no invented model ids — the standing constraints from
  TASK_2026_262 carry over unchanged.
