# TASK_2026_249 — a documented gate that cannot run

Found 2026-08-15 while rewriting the skill-synthesis docs (TASK_2026_248).

## What is broken

`apps/ptah-docs/project.json` has a `check` target running `astro check`, and
`apps/ptah-docs/CLAUDE.md` lists it under **Build & Run**:

> `nx check ptah-docs` — `astro check` (type/link validation).

`@astrojs/check` is **not installed**. It appears in neither `package.json` nor
`package-lock.json`, and `node_modules/@astrojs/` contains `compiler`,
`internal-helpers`, `markdown-remark`, `mdx`, `prism`, `sitemap`, `starlight`
and `telemetry` — no `check`.

## Why it is worse than a plain failure

`astro check` does not simply exit when the dependency is absent. It **prompts**:

```
To continue, Astro requires the following dependency to be installed: @astrojs/check.
```

- In a **CI / non-TTY** context it refuses and errors — loud, recoverable.
- In an **interactive shell** it waits on the prompt. Measured here: a run left
  for the full **600-second** timeout produced an **empty** output file. No
  error, no progress, nothing to diagnose.

## The cost, measured

Three documentation agents in one session each launched `nx check ptah-docs`,
each stopped to wait for it, and each returned with no report and no gate
result. From the outside that is indistinguishable from an agent quitting early,
and it was initially diagnosed as exactly that. The real answer is that the gate
they were told to run cannot complete.

The knock-on: link validation for a rewrite that ADDED a page and re-pointed
cross-references had to be done by hand (a grep of every `(/skill-synthesis/...)`
target against the files on disk — all seven resolved). That works for one
section and does not scale.

## The fix — one of two, not both

1. **Install it.** Add `@astrojs/check` and `typescript` as devDependencies and
   let the target work. Note this repo's `npm install` triggers a postinstall
   Electron native rebuild, so it is not a free change to make mid-session —
   which is why it was not done at discovery time.
2. **Delete the target and the CLAUDE.md line.** If nobody has ever run it, it
   is not a gate; it is a trap that costs an agent ten minutes each time it is
   believed.

Either is fine. What is not fine is leaving a validation gate documented in the
lib's own CLAUDE.md that silently hangs, because every future agent handed that
file will try it.

## While it is broken

Do NOT put `nx check ptah-docs` in a subagent's acceptance gates. `nx build
ptah-docs` works, is fast (~7s for 143 pages), and catches the failures that
actually break the site.
