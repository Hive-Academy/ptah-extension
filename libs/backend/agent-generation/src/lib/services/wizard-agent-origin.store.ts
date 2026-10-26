/**
 * WizardAgentOriginStore - records "the setup wizard wrote this agent file".
 *
 * File: `{harnessRoot}/.ptah/setup-wizard/agent-origins.json`, shaped
 * `{ version: 1, agents: { [slug]: { hash, writtenAt } } }`.
 *
 * The recorded hash is what lets a wizard re-run label a row "Unchanged since
 * the setup wizard wrote it" (D10): when the file on disk still hashes to the
 * recorded value, nobody edited it after the wizard wrote it. The hash MUST be
 * {@link computeSourceHash} — the same function the user-layer mirror uses for
 * `sourceHash` / `pendingSourceHash` — so the two records are comparable.
 *
 * Failure behaviour:
 * - A missing file is the normal state of a workspace the wizard never wrote
 *   into (or wrote into before this store existed) and reads as empty. Every
 *   slug is then absent, which the UI shows as a plain "Workspace file".
 * - A file that exists but cannot be read or does not validate is logged and
 *   ALSO reads as empty. That is the safe direction: a damaged record can only
 *   remove the "unchanged" label, never invent one.
 * - A failed write is logged and reported as `false`; it never throws, because
 *   losing the origin label must not fail the wizard run that wrote the agent.
 *
 * Writes are atomic and retried (temp + rename, `atomicWriteWithRetry`), and
 * the read-modify-write of each origins file is serialized in-process so a
 * batch of agents recorded concurrently cannot drop each other's entries.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { atomicWriteWithRetry } from '@ptah-extension/harness-sync';
import { computeSourceHash, isErrnoCode } from './user-layer/source-hash';

const SERVICE_TAG = '[WizardAgentOriginStore]';

/** Directory under the harness root that holds setup-wizard bookkeeping. */
export const WIZARD_STATE_DIR = join('.ptah', 'setup-wizard');
export const AGENT_ORIGINS_FILE = 'agent-origins.json';
export const AGENT_ORIGINS_VERSION = 1;

const AgentOriginEntrySchema = z.object({
  /** `computeSourceHash` of the bytes the wizard wrote (`sha256:<hex>`). */
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /** Epoch milliseconds of the write. */
  writtenAt: z.number().int().nonnegative(),
});

export const AgentOriginsFileSchema = z.object({
  version: z.literal(AGENT_ORIGINS_VERSION),
  agents: z.record(z.string().min(1), AgentOriginEntrySchema),
});

export type AgentOriginEntry = z.infer<typeof AgentOriginEntrySchema>;
export type AgentOriginsFile = z.infer<typeof AgentOriginsFileSchema>;
export type AgentOrigins = AgentOriginsFile['agents'];

@injectable()
export class WizardAgentOriginStore {
  /** Tail of the pending read-modify-write chain, per origins file path. */
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** Absolute path of the origins file for a harness root. */
  originsPath(harnessRoot: string): string {
    return join(harnessRoot, WIZARD_STATE_DIR, AGENT_ORIGINS_FILE);
  }

  /**
   * Hash a written agent file the way this store expects it recorded.
   * Delegates to {@link computeSourceHash} so the value matches the mirror's.
   */
  hashWrittenFile(filePath: string): Promise<string> {
    return computeSourceHash(filePath);
  }

  /**
   * Every recorded origin for a harness root. Missing, unreadable or invalid
   * files read as an empty record (see the module comment).
   */
  async read(harnessRoot: string): Promise<AgentOrigins> {
    const path = this.originsPath(harnessRoot);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a missing origins file is the
      // normal state of a workspace the wizard never wrote into, and an
      // unreadable one only removes the "unchanged since the wizard wrote it"
      // label; the latter is warned below, and the wizard run is unaffected.
      if (isErrnoCode(error, 'ENOENT')) {
        return {};
      }
      this.logger.warn(
        `${SERVICE_TAG} Agent origins unreadable, treating as empty`,
        {
          path,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return {};
    }

    try {
      return AgentOriginsFileSchema.parse(JSON.parse(raw)).agents;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a corrupt origins file reads
      // as empty so no row can be labelled unchanged on a damaged record; the
      // warning reports the corruption and the next write replaces the file.
      this.logger.warn(
        `${SERVICE_TAG} Agent origins invalid, treating as empty`,
        {
          path,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return {};
    }
  }

  /**
   * Record that the wizard wrote `slug` with content hash `hash`. Call it only
   * for the `written` outcome: a kept or skipped file was not written by the
   * wizard and must not gain the label.
   *
   * @returns `false` when the record did not land. Non-fatal by contract; the
   *   failure is logged and the row degrades to "Workspace file".
   */
  recordWritten(
    harnessRoot: string,
    slug: string,
    hash: string,
  ): Promise<boolean> {
    const entry = AgentOriginEntrySchema.safeParse({
      hash,
      writtenAt: Date.now(),
    });
    if (slug.length === 0 || !entry.success) {
      this.logger.warn(`${SERVICE_TAG} Refusing to record an invalid origin`, {
        slug,
        hash,
        error: entry.success ? 'empty slug' : entry.error.message,
      });
      return Promise.resolve(false);
    }
    const recorded = entry.data;
    return this.mutate(harnessRoot, 'record', slug, (agents) => ({
      ...agents,
      [slug]: recorded,
    }));
  }

  /**
   * Drop the origin of `slug` (a community pack replaced the file). A slug
   * with no record is a no-op that touches nothing on disk.
   *
   * @returns `false` when the updated record did not land.
   */
  forget(harnessRoot: string, slug: string): Promise<boolean> {
    return this.mutate(harnessRoot, 'forget', slug, (agents) => {
      if (!Object.prototype.hasOwnProperty.call(agents, slug)) {
        return null;
      }
      return Object.fromEntries(
        Object.entries(agents).filter(([key]) => key !== slug),
      );
    });
  }

  /**
   * Serialized read-modify-write of one origins file. `change` returns the new
   * agents record, or `null` when nothing needs writing.
   */
  private mutate(
    harnessRoot: string,
    action: 'record' | 'forget',
    slug: string,
    change: (agents: AgentOrigins) => AgentOrigins | null,
  ): Promise<boolean> {
    const path = this.originsPath(harnessRoot);
    const previous = this.pending.get(path) ?? Promise.resolve(true);
    const next = previous.then(async () => {
      const updated = change(await this.read(harnessRoot));
      return updated === null ? true : this.write(path, action, slug, updated);
    });
    this.pending.set(path, next);
    void next.then(() => {
      if (this.pending.get(path) === next) {
        this.pending.delete(path);
      }
    });
    return next;
  }

  private write(
    path: string,
    action: 'record' | 'forget',
    slug: string,
    agents: AgentOrigins,
  ): boolean {
    const file: AgentOriginsFile = {
      version: AGENT_ORIGINS_VERSION,
      agents: sortBySlug(agents),
    };
    try {
      atomicWriteWithRetry(path, `${JSON.stringify(file, null, 2)}\n`);
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a lost origin record only
      // degrades the row label to "Workspace file"; the warning reports the
      // failed write and `false` tells the caller it did not land.
      this.logger.warn(`${SERVICE_TAG} Failed to persist agent origins`, {
        path,
        action,
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/** Deterministic key order so an unchanged record writes byte-identical JSON. */
function sortBySlug(agents: AgentOrigins): AgentOrigins {
  return Object.fromEntries(
    Object.keys(agents)
      .sort()
      .map((slug) => [slug, agents[slug]]),
  );
}
