/**
 * Skill Synthesis e2e (TASK_2026_HERMES Track 2).
 *
 * Surface under test: `skillSynthesis:listCandidates`, `skillSynthesis:stats`,
 * `skillSynthesis:promote` RPC methods backed by `@ptah-extension/skill-synthesis`.
 * The auto-promotion path requires the `SkillInvocationTracker` to record ≥3
 * successful invocations against the same candidate before the promotion
 * service elevates its status and materialises `~/.ptah/skills/<name>/SKILL.md`.
 *
 * Why skipped:
 *   Recording invocations requires completed chat sessions driven by real agent
 *   turns (the invocation tracker is hooked into the agent session lifecycle,
 *   not a free-standing CLI command). Replaying three synthetic "successful
 *   sessions" through the tracker without real Claude API calls is not currently
 *   possible with the CLI harness. The placeholders below document the observable
 *   surfaces. Unblocking paths:
 *     (a) A `ptah skill-synthesis record-invocation` CLI command is added to
 *         the router, enabling synthetic seeding in headless mode; or
 *     (b) The harness exposes an RPC method that drives the invocation tracker
 *         directly (no upstream API call needed).
 *
 * When unblocked, the test flow is:
 *   1. createTmpHome() — isolated ~/.ptah for this test.
 *   2. Three synthetic invocation records are seeded (via CLI command or RPC).
 *   3. The promotion service auto-fires (watches the threshold) and the
 *      candidate status transitions to 'promoted'.
 *   4. CliRunner.spawnOneshot(['skill-synthesis', 'list', '--status', 'promoted'])
 *      → assert at least one candidate in result.
 *   5. Assert `fs.existsSync(path.join(tmp.ptahDir, 'skills', <name>, 'SKILL.md'))`.
 *   6. tmp.cleanup() — remove generated SKILL.md.
 *
 * Prerequisite: `ptah skill-synthesis list|promote|reject|invocations|stats`
 * CLI subcommands added to `apps/ptah-cli/src/cli/router.ts` (not yet present
 * as of the Thoth hub work).
 */

describe.skip('skill synthesis e2e (TASK_2026_HERMES Track 2 — requires real session invocations)', () => {
  it('3 successful invocations auto-promote a candidate', () => {
    /* Stub — see file header. */
  });

  it('promoted candidate materialises SKILL.md at ~/.ptah/skills/<name>/SKILL.md', () => {
    /* Stub — see file header. */
  });

  it('skillSynthesis:stats reflects totalPromoted ≥ 1 after auto-promotion', () => {
    /* Stub — see file header. */
  });

  it('skillSynthesis:reject transitions candidate to rejected status', () => {
    /* Stub — see file header. */
  });

  it('skillSynthesis:listCandidates filter=all returns candidates across all statuses', () => {
    /* Stub — see file header. */
  });
});
