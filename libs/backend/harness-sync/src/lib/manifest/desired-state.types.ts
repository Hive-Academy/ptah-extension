/**
 * The desired state: what SHOULD exist, derived purely from the sources.
 *
 * Deliberately target-agnostic. A target decides where a slug lands and in what
 * shape; it never decides WHICH slugs exist. That split is what lets Batch 2 add
 * four more targets without touching the builder.
 */

import type {
  HarnessCollision,
  HarnessSourcesStatus,
  HarnessTargetId,
  McpServerConfig,
} from '@ptah-extension/shared';

/** A skill directory that should reach every detected target. */
export interface HarnessDesiredSkill {
  /** Directory name, e.g. `orchestration`. Also the frontmatter `name`. */
  slug: string;
  /** Absolute source directory containing `SKILL.md`. */
  sourceDir: string;
  /** {@link hashDirSync} over the source directory. */
  contentHash: string;
}

/** A slash-command markdown file. */
export interface HarnessDesiredCommand {
  /** File name without `.md`, e.g. `orchestrate`. */
  slug: string;
  sourceFile: string;
  contentHash: string;
}

/**
 * A subagent definition.
 *
 * Present in the desired state for the rival-CLI targets Batch 2 adds, which
 * transform agents into `.codex/agents/*.toml` and friends. The Claude target
 * writes NOTHING here: `{ws}/.claude/agents` is a SOURCE the user layer mirrors
 * FROM, and writing into it would close a source→target→source loop.
 */
export interface HarnessDesiredAgent {
  slug: string;
  sourceFile: string;
  contentHash: string;
}

/**
 * An MCP server that should appear in a target's config file.
 *
 * Unlike a skill or a command, this artifact has no source FILE — its source is
 * the user's recorded intent (`~/.ptah/mcp-installed.json`). The hash is
 * therefore computed from the transport config itself, which is what lets an
 * unchanged intent produce a byte-identical config file on every reconcile.
 */
export interface HarnessDesiredMcpServer {
  /** Config key, e.g. `github`. */
  serverKey: string;
  /** Registry name for display, e.g. `io.github.user/server`. */
  registryName: string;
  config: McpServerConfig;
  /** Targets the user asked for. A target not listed here must not write it. */
  targets: HarnessTargetId[];
  /** {@link hashMcpConfig} over `config`. */
  contentHash: string;
}

export interface HarnessDesiredState {
  skills: HarnessDesiredSkill[];
  commands: HarnessDesiredCommand[];
  agents: HarnessDesiredAgent[];
  mcp: HarnessDesiredMcpServer[];
  /** Sources that lost a name/case/reserved-name contest. Reported, not renamed. */
  collisions: HarnessCollision[];
  sources: HarnessSourcesStatus;
  /**
   * Absolute directories the sources live in: the user-layer roots, every
   * overlaid plugin directory, and the layout's declared `legacyLinkRoots`.
   *
   * Carried on the desired state rather than injected into a target because it
   * changes with the sources on every pass — a plugin enabled since the last
   * reconcile adds a root — and because a target that took it at construction
   * time would answer with whatever was true when DI ran.
   *
   * Its ONE consumer is `ClaudeTarget`, which unlinks a symlink at a desired
   * path only when the link resolves inside one of these roots (a leftover
   * `SkillJunctionService` junction) and reports it `foreign` otherwise (the
   * user's own link, which Ptah must not delete).
   */
  sourceRoots: readonly string[];
}
