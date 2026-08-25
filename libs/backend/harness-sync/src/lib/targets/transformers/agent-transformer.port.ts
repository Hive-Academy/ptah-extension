/**
 * How a user-layer subagent becomes a rival CLI's own agent format.
 *
 * Moved here from `agent-generation/services/cli-agent-transforms/` in
 * TASK_2026_278 Batch 2. The transformation logic is unchanged; what changed is
 * WHO drives it. It used to be `MultiCliAgentWriterService`, invoked from the
 * setup wizard and from two host activation scripts, each with its own hash
 * gate and its own idea of which CLIs to write for. Now a target owns its
 * transformer and the reconciler owns the lifecycle, so an agent added to the
 * user layer reaches every detected CLI through the same manifest-owned path as
 * a skill.
 *
 * The input shrank in the move. `GeneratedAgent` carried template ids, versions
 * and customization records that no transformer ever read, and depending on it
 * would have made `harness-sync` import `agent-generation`. Two fields do the
 * whole job: the id and the markdown.
 */

import type { HarnessTargetId } from '@ptah-extension/shared';

/** One user-layer agent, ready to transform. */
export interface HarnessAgentSource {
  /** Bare slug, e.g. `backend-developer`. Never prefixed. */
  agentId: string;
  /** Full markdown of `~/.ptah/user/agents/<agentId>.md`, frontmatter included. */
  content: string;
}

export interface IHarnessAgentTransformer {
  readonly target: HarnessTargetId;

  /**
   * Workspace-relative POSIX directory the agents land in, e.g.
   * `.codex/agents`.
   *
   * Declared rather than derived from `relPathFor` so the `.gitignore` block
   * has a directory to name without synthesizing a fake agent id to take the
   * dirname of. `relPathFor` builds on it, which is what keeps the two from
   * disagreeing.
   */
  readonly dirRel: string;

  /**
   * Workspace-relative POSIX path this agent lands at, e.g.
   * `.codex/agents/backend-developer.toml`. Also the manifest key, so it must
   * be stable for a given id.
   */
  relPathFor(agentId: string): string;

  /** Rewritten content in the target CLI's format. Pure; no I/O. */
  transform(source: HarnessAgentSource): string;

  /**
   * Did the Ptah pipeline write this file? Pure; takes the content, no I/O.
   *
   * The question a target has to answer about an agent file sitting at a
   * desired path that NO manifest owns. Two answers are wrong in different
   * ways: call it foreign and the target freezes forever on copies Ptah itself
   * produced — that is what left 15 `.codex/agents/*.toml` and 6
   * `.github/agents/*.agent.md` permanently unreconcilable once the
   * `MultiCliAgentWriterService` deletion took their bookkeeping with it. Call
   * it ours on a NAME match and a user's hand-written agent gets silently
   * overwritten.
   *
   * So each transformer answers for its OWN format, and each accepts both the
   * signature it emits today and the one its deleted predecessor emitted —
   * between them, those two pipelines produced every file actually on disk. A
   * hash comparison cannot substitute: an adoptable file is precisely one whose
   * content DIFFERS from current output, which is why it needs rewriting.
   *
   * Content-based rather than name-based on purpose. `ptah-notes.agent.md` is
   * not evidence, and neither is `.github/agents/backend-developer.agent.md`
   * happening to be a name Ptah also uses.
   */
  isPtahOutput(content: string): boolean;
}

/** Leading `---` … `---` block, tolerating a BOM and CRLF. */
const FRONTMATTER_BLOCK = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/;

/**
 * `source: ptah` inside the leading YAML frontmatter.
 *
 * The signature `rewriteFrontmatter` emits, and emitted from inside
 * `agent-generation` before this lib absorbed the transformers verbatim — so it
 * identifies both current output and every markdown leftover of the deleted
 * `MultiCliAgentWriterService`. Shared by the two markdown transformers; Codex's
 * TOML format needs its own test.
 *
 * Scoped to the frontmatter block deliberately: the same two words in the prose
 * of an agent a user wrote must not authorise overwriting it. No frontmatter
 * means `false`, which is the safe direction.
 */
export function hasPtahFrontmatterSignature(content: string): boolean {
  const frontmatter = FRONTMATTER_BLOCK.exec(content);
  if (frontmatter === null) return false;
  return /^source:\s*ptah\s*$/m.test(frontmatter[1]);
}
