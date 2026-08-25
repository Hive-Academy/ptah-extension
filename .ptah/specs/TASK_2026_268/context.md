# Context — TASK_2026_268

## Where this came from

TASK_2026_256 split `skill-synthesis.service.ts` (2027 → 1232) because its
documented registration seam, `start()`, had six unrelated stage protocols
sitting on top of it. That worked. The observation that followed was that the
file is still over 1000, and that nothing in the repo would have flagged the
growth in the first place.

Measured 2026-08-17, hand-written production `.ts` only (`*.spec.ts`, `*.d.ts`
and `libs/api/core/src/lib/generated-prisma-client/**` excluded):

| Threshold  | Files | of 2681 |
| ---------- | ----- | ------- |
| > 1000 LOC | 50    | 1.9 %   |
| > 700 LOC  | 137   | 5.1 %   |

`eslint.config.mjs` has no `max-lines` rule. `CLAUDE.md` has no size standard.

## The decision taken

Not a blanket 700-line sweep. 137 behaviour-preserving refactors, each needing
its own proof, is a programme rather than a task — and some of those files are
not defects. The unit of splitting is a CONCERN, not a line budget.

Two halves, and only the first is unconditional:

1. **Stop the bleeding.** `max-lines` at 700, **warn not error**, so the 137
   existing files do not block every commit, plus the standard and its
   guardrails in `CLAUDE.md` so new and touched code holds the line by default.
2. **Map before digging.** Survey the 50 files over 1000, classify each, judge
   whether a real seam is buried, and emit a ranked backlog. The user picks
   what to execute from that list.

## The facade rule

The technique that made 256 cheap: the public class keeps its name, its DI
token and its method signatures, and the extracted concern becomes a
collaborator injected into it. `SkillSynthesisService` still answers to the
same token; `StageHandlersService` took the six protocols. No consumer changed,
no DI registration rippled.

This only applies where there IS a contract to preserve. Five techniques, and
they are not interchangeable:

| Group                   | Example                                   | Technique                                         |
| ----------------------- | ----------------------------------------- | ------------------------------------------------- |
| Service with a DI token | `skill-synthesis.service.ts`              | Facade — the 256 template                         |
| Store                   | `skill-candidate.store.ts` (1462)         | Facade, split by query group                      |
| RPC handler class       | `skills-synthesis-rpc.handlers.ts` (2295) | Split by method namespace; registration stays put |
| Type barrel             | `rpc.types.ts` (3589)                     | No facade needed — split by domain, re-export     |
| Angular component       | `diff-view.component.ts` (2016)           | Child components, not facades                     |
| Generated               | Prisma client                             | Exempt                                            |

## Guardrails against file explosion

The stated goal is BALANCE — a 700 cap chased blindly produces fragment sprawl,
which is a different maintainability problem wearing better numbers.

1. **Nameability test.** If the extracted piece cannot take a noun-phrase name
   that is not `helpers` / `utils` / `common` / `misc`, it is not a seam. Do
   not cut there.
2. **No file under ~150 lines** created solely to satisfy the ceiling.
3. **Constructor params are the real gate.** A split that pushes a class past
   ~8 injected dependencies cut in the wrong place.
4. **Prefer 2–3 collaborators over 6 fragments.** 256 produced exactly two new
   files from an 800-line extraction.

## What "a real seam is buried" means

The count alone is not the signal. 256 was worth doing because an important,
documented role was hidden among concerns that had nothing to do with it. A
file can be long and fine: a contract barrel, an exhaustive type union, a
generated artifact. The survey's job is to tell those apart and say WHY, per
file, so that a later refactor starts from a hypothesis rather than a number.

## Verification

- `npx nx lint <any project>` emits `max-lines` as a WARNING, and a commit with
  an over-length file still passes the pre-commit hook.
- `CLAUDE.md` states the ceiling, the facade rule and the four guardrails.
- Every one of the 50 files carries a classification, a verdict, and a proposed
  cut or an exemption reason. None is left unjudged.
