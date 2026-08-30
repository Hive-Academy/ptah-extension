// 0041_skill_md_migration_state — the persisted marker that lets the SKILL.md
// content migration stop re-walking the disk on every launch (TASK_2026_331 B4).
//
// WHAT THIS IS FOR. `migrateSkillMdFiles` is a ONE-TIME CONTENT migration: it
// injects a `when_to_use:` frontmatter field into every `SKILL.md` that lacks
// one. After the first successful pass every file already carries the field, so
// each later launch re-reads the whole tree only to count it as skipped. It
// runs TWICE per start — once for the active root and once for the candidates
// root (`skill-synthesis.service.ts`).
//
// Measured 2026-08-28 against a real `~/.ptah/skills` holding 2420 `SKILL.md`
// files (9.2 MB): walk 188.6 ms + read 199.2 ms = 388 ms, warm cache,
// synchronous, on the main thread, with no yields. Do not quote the ~2 s figure
// from the original plan; it exists nowhere in this repo and was never measured.
//
// ONE ROW PER ROOT, NOT ONE ROW FOR THE WHOLE TABLE. `skills_root` is the
// PRIMARY KEY, so the at-most-one constraint is per scanned root — the same
// keyed-state idiom `0014_boot_scan_state` uses (`PRIMARY KEY (pipeline,
// workspace_fingerprint)`).
//
// A genuinely single-row table (`id INTEGER PRIMARY KEY CHECK (id = 1)`) would
// be WRONG here, for two reasons that are both live:
//
//   1. PARTIAL FAILURE. The two roots are walked back to back in one call
//      sequence. If the active root's walk succeeds and the candidates root's
//      walk fails, a shared row written by the first would assert that BOTH are
//      migrated, and the failed root would never be re-walked until the 24 h
//      window lapsed. Per-root rows make each marker a statement about the tree
//      it actually names.
//   2. THE ROOTS ARE NOT FIXED. `candidatesRoot` defaults to a SUBDIRECTORY of
//      `activeRoot`, but `skillSynthesis.candidatesDir` can repoint it anywhere,
//      and `ptah.skillsRoot` can move the active root too. A row keyed by path
//      means a repointed root simply has no marker and gets walked — the safe
//      direction. A shared row would carry the previous location's verdict over
//      to a tree nobody has ever scanned.
//
// `migration_version` is the version of the CONTENT TRANSFORM in
// `skill-md-migration.ts`, NOT this schema's version. Bumping the constant
// there invalidates every stored marker and forces one more full walk, which is
// how a future change to the frontmatter injection re-runs against files that
// were already migrated by the previous shape.
//
// `last_scan_at` is epoch ms. The reader treats a marker older than 24 h as
// stale and walks anyway, so a file edited outside Ptah is picked up within a
// day without the marker ever having to be invalidated by hand.
//
// DIRECTORY mtime IS DELIBERATELY NOT A COLUMN. A directory's mtime does not
// change when a file inside one of its subdirectories is edited, so a mtime
// comparison would confidently skip real work. The only inputs are the
// transform version and the wall-clock age.
//
// BOTH COLUMNS ARE `NOT NULL` and the table is created empty. That is safe
// where `0033`/`0036`/`0040`'s added columns could not be: this is a NEW table
// with no pre-existing rows and no INSERT anywhere in the tree that predates
// it, so there is no legacy statement to break and no unknown value to
// represent. A row exists only because a walk completed cleanly; "we have never
// scanned this root" is the ABSENCE of a row, which the reader already has to
// handle.
//
// IDEMPOTENT: `CREATE TABLE IF NOT EXISTS` only, no rebuild, no backfill —
// applying it twice is a no-op, exactly like `0014`. The runner's
// `schema_migrations` ledger still guarantees exactly-once regardless.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS skill_md_migration_state (
  skills_root TEXT PRIMARY KEY,
  migration_version INTEGER NOT NULL,
  last_scan_at INTEGER NOT NULL
);
`;
