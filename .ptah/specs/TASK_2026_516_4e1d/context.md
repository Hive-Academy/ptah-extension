# Context — TASK_2026_516

## Why this exists

An implementation lane working on TASK_2026_511 reported that the manifest
versions did not match the root `CLAUDE.md`. I verified the claim against
`package.json` rather than accepting it.

| Item | Root `CLAUDE.md` says | `package.json` has |
| --- | --- | --- |
| Angular | 21 | 22.1.7 |
| Nx | 22.6 | 23.2.1 |
| TypeScript | 5.9 | 6.0.3 |
| Electron | 40 | 44.4.3 |
| Zod | 4 | 4.6.5 |
| better-sqlite3 | not stated | ^13.0.3 |

Measured on 2026-09-21 with `node -e "const p=require('./package.json') ..."`.

Every agent that reads `CLAUDE.md` before starting work is told the wrong
stack. TypeScript 5.9 against 6.0.3 is a major version, and Electron 40
against 44 is four. An agent that writes code for the documented versions is
writing for a tree that does not exist.

## Scope

In scope:

- Correct the version list in the **Tech Stack** section of the root
  `CLAUDE.md`.
- Audit the other counted facts in the same file while you are there, because
  a count is the kind of fact that drifts silently. Known suspects:
  - "28 PLATFORM_TOKENS" in two places. An earlier note recorded the real
    figure as 25 in `platform-core/src/di/tokens.ts`. Count it and write the
    real number.
  - "13 apps", "29 backend libs", "25 frontend libs", "15 NestJS libs",
    "10 web libs". Verify each against the tree.
  - The migration count implied by the module index.
- Where a number is likely to drift again, prefer naming the file that owns
  the truth over repeating the number.

Out of scope:

- Upgrading or downgrading any dependency. This is a documentation fix.
- Per-lib `CLAUDE.md` files, unless one repeats a version corrected here.

## Acceptance

- Every version in the root `CLAUDE.md` Tech Stack section matches
  `package.json`.
- Every count stated in the root `CLAUDE.md` matches the tree, or is replaced
  by a pointer to the file that owns it.
- No dependency changed.
