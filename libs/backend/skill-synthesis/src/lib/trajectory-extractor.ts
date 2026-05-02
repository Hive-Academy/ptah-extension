/**
 * TrajectoryExtractor — derives a stable, normalized trajectory representation
 * from a Claude session JSONL trace.
 *
 * Trigger contract (architecture §6.5):
 *  - Sessions with ≥5 user/assistant turns AND a success marker are eligible.
 *  - At most one candidate is produced per session.
 *
 * "Normalization" strips workspace-specific paths and timestamps so that two
 * structurally identical trajectories produce the same SHA-256 hash and the
 * same canonical text used for embedding.
 */
import * as crypto from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, type JsonlReaderService } from '@ptah-extension/agent-sdk';

/** Minimum number of user/assistant turns required to consider a session. */
export const MIN_TURNS_FOR_TRAJECTORY = 5;

/** Heuristic phrases interpreted as "task succeeded". */
const SUCCESS_MARKERS = [
  /\btask\s+complete(d)?\b/i,
  /\bdone[!.\s]/i,
  /\bsuccessfully\s+(completed|implemented|fixed|resolved)\b/i,
  /\ball\s+tests?\s+pass/i,
  /\b✅\b/,
];

export interface ExtractedTrajectory {
  /** Stable sha256 of the normalized turn sequence. */
  hash: string;
  /** Canonical text snapshot used for embedding/synthesis prompts. */
  canonicalText: string;
  /** Total number of user+assistant turns considered. */
  turnCount: number;
  /** A short auto-generated description (first user turn, sliced). */
  shortDescription: string;
  /** A slug-friendly name derived from the description. */
  slug: string;
}

@injectable()
export class TrajectoryExtractor {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonlReader: JsonlReaderService,
  ) {}

  /**
   * Read the JSONL for a session and return an extracted trajectory if the
   * eligibility rules are met. Returns null when the session is too short
   * or lacks a success marker.
   */
  async extract(
    sessionId: string,
    workspaceRoot: string,
  ): Promise<ExtractedTrajectory | null> {
    const sessionsDir =
      await this.jsonlReader.findSessionsDirectory(workspaceRoot);
    if (!sessionsDir) {
      this.logger.debug('[skill-synthesis] no sessions dir for workspace', {
        workspaceRoot,
        sessionId,
      });
      return null;
    }
    const filePath = `${sessionsDir}/${sessionId}.jsonl`;
    let messages;
    try {
      messages = await this.jsonlReader.readJsonlMessages(filePath);
    } catch (err) {
      this.logger.warn('[skill-synthesis] could not read session JSONL', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const m of messages) {
      const role = this.roleOf(m);
      if (!role) continue;
      const text = this.textOf(m);
      if (!text) continue;
      turns.push({ role, text });
    }

    if (turns.length < MIN_TURNS_FOR_TRAJECTORY) {
      return null;
    }
    if (!this.hasSuccessMarker(turns)) {
      return null;
    }

    const normalized = turns
      .map((t) => `[${t.role}] ${this.normalize(t.text, workspaceRoot)}`)
      .join('\n---\n');
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');

    const firstUser = turns.find((t) => t.role === 'user')?.text ?? '';
    const shortDescription = this.truncate(firstUser.replace(/\s+/g, ' '), 140);
    const slug = this.slugify(shortDescription);

    return {
      hash,
      canonicalText: normalized,
      turnCount: turns.length,
      shortDescription: shortDescription || 'Captured workflow',
      slug: slug || `skill-${hash.slice(0, 8)}`,
    };
  }

  private roleOf(msg: unknown): 'user' | 'assistant' | null {
    if (!msg || typeof msg !== 'object') return null;
    const m = msg as { type?: string; message?: { role?: string } };
    const explicit = m.message?.role;
    if (explicit === 'user' || explicit === 'assistant') return explicit;
    if (m.type === 'user' || m.type === 'assistant') return m.type;
    return null;
  }

  private textOf(msg: unknown): string {
    if (!msg || typeof msg !== 'object') return '';
    const m = msg as { message?: { content?: unknown } };
    const content = m.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const c of content) {
        if (c && typeof c === 'object') {
          const block = c as { type?: string; text?: string };
          if (block.type === 'text' && typeof block.text === 'string') {
            parts.push(block.text);
          }
        }
      }
      return parts.join('\n');
    }
    return '';
  }

  private hasSuccessMarker(
    turns: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>,
  ): boolean {
    // Look for markers in the trailing 25% of the conversation (i.e. recent
    // assistant output). Keeps early "I'll get this done" false positives out.
    const tailStart = Math.max(0, Math.floor(turns.length * 0.75));
    for (let i = tailStart; i < turns.length; i++) {
      const t = turns[i];
      if (t.role !== 'assistant') continue;
      for (const re of SUCCESS_MARKERS) {
        if (re.test(t.text)) return true;
      }
    }
    return false;
  }

  private normalize(text: string, workspaceRoot: string): string {
    let out = text;
    if (workspaceRoot) {
      const escaped = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'gi'), '<WORKSPACE>');
    }
    // Strip ISO timestamps + epoch millis to keep hashes stable.
    out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TS>');
    out = out.replace(/\b\d{13}\b/g, '<EPOCH>');
    return out.trim();
  }

  private truncate(s: string, max: number): string {
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
