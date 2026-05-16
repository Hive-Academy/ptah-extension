/**
 * MemoryWriterAdapter — implements `IMemoryWriter` from `@ptah-extension/platform-core`
 * on top of the existing `MemoryStore`.
 *
 * Identity model: the upsert key is `(workspaceFingerprint, subject)`. The
 * fingerprint is encoded inside the memory's `content` field via the
 * `<!-- ptah-seed:hash=<hex64>;fp=<hex16>;v=1 -->` prefix line — the
 * `Memory` schema has no metadata column, so the prefix is the only
 * schema-free way to attach this identity.
 *
 * Dedupe: SHA-256 of `subject + ' ' + content` (single space — see plan
 * §3.5 reference; plan §D4 mentions a null byte but §3.5 reference is
 * authoritative). When exactly one match exists and its embedded hash
 * equals the new hash, no DB writes are performed.
 */

import { createHash } from 'crypto';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  IMemoryWriter,
  MemoryWriteRequest,
  MemoryWriteResult,
} from '@ptah-extension/platform-core';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryStore } from './memory.store';
import type { MemoryInsert } from './memory.types';

const PREFIX_RE =
  /^<!-- ptah-seed:hash=([a-f0-9]{64});fp=([a-f0-9]{16});v=1 -->\n/;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function formatSeedPrefix(hash: string, fp: string): string {
  return `<!-- ptah-seed:hash=${hash};fp=${fp};v=1 -->\n`;
}

export function parseSeedPrefix(
  content: string,
): { hash: string; fp: string } | null {
  const m = PREFIX_RE.exec(content);
  return m ? { hash: m[1], fp: m[2] } : null;
}

@injectable()
export class MemoryWriterAdapter implements IMemoryWriter {
  constructor(
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  async upsert(req: MemoryWriteRequest): Promise<MemoryWriteResult> {
    // NOTE: plan §D4 mentions a null-byte separator, but plan §3.5 reference
    // code uses a single space. Following §3.5.
    const newHash = sha256Hex(`${req.subject} ${req.content}`);

    // Tier-scoped scan (≤500 rows). No workspace filter — we want
    // fingerprint-based identity which survives moves/renames.
    const candidates = this.store.list({ tier: req.tier, limit: 500 }).memories;
    const matches = candidates.filter((m) => {
      if (m.subject !== req.subject) return false;
      const parsed = parseSeedPrefix(m.content);
      return parsed?.fp === req.workspaceFingerprint;
    });

    if (matches.length === 1) {
      const parsed = parseSeedPrefix(matches[0].content);
      if (parsed?.hash === newHash) {
        this.logger.debug(
          `[SetupWizard] Memory '${req.subject}' unchanged; skipping reseed`,
        );
        return { status: 'unchanged', id: matches[0].id };
      }
    }

    for (const m of matches) this.store.forget(m.id);

    const prefixed =
      formatSeedPrefix(newHash, req.workspaceFingerprint) + req.content;
    const insert: MemoryInsert = {
      workspaceRoot: req.workspaceRoot,
      sessionId: null,
      tier: req.tier,
      kind: req.kind,
      subject: req.subject,
      content: prefixed,
      pinned: req.pinned,
      salience: req.salience ?? (req.pinned ? 1.0 : 0.6),
      decayRate: req.decayRate ?? (req.pinned ? 0 : 0.01),
      sourceMessageIds: [],
      expiresAt: null,
    };
    const tokenCount = Math.max(1, Math.ceil(prefixed.length / 4));
    const id = await this.store.insertMemoryWithChunks(insert, [
      { ord: 0, text: prefixed, tokenCount },
    ]);
    return {
      status: matches.length > 0 ? 'replaced' : 'inserted',
      id,
    };
  }

  purgeBySubjectPattern(
    pattern: string,
    mode: 'substring' | 'like',
    workspaceRoot: string,
  ): number {
    return this.store.purgeBySubjectPattern(pattern, mode, workspaceRoot);
  }
}
