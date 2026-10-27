/**
 * LocalItemApprovals - the server-held approval registry for marketplace
 * local items (TASK_2026_701 B12, A21).
 *
 * Every local item a marketplace install offers to replace (a consent plan
 * item, or an item in a no-dialog kept report) is recorded here with the
 * content digest it had when it was offered and the identity of the source
 * that would replace it. The client receives only the `approvalId`; the
 * digest, the paths and the source identity never leave the server. A later
 * replace decision names the `approvalId`, and the replace route re-digests
 * the item immediately before it mutates it: any difference means the user
 * approved something that is no longer there, so the item is kept.
 *
 * Bounded and short-lived: at most {@link MAX_LOCAL_ITEM_APPROVALS} entries
 * (the oldest is evicted first), each valid until its own expiry — the consent
 * token's lifetime for an install plan, {@link KEPT_ITEM_APPROVAL_TTL_MS} for a
 * kept report. An evicted or expired entry reads as unknown, which every
 * caller treats as "keep".
 *
 * In-memory by design: a host restart forgets every approval, so a stale
 * decision can never act on a file after the process that saw it is gone.
 */
import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type {
  ExternalLocalItemKind,
  HarnessTargetId,
  LocalItemFamily,
  SkillCloneKind,
} from '@ptah-extension/shared';

/** Approval entries kept at once; the oldest is evicted first. */
export const MAX_LOCAL_ITEM_APPROVALS = 256;

/** Lifetime of an approval issued for a kept report (no consent token). */
export const KEPT_ITEM_APPROVAL_TTL_MS = 30 * 60 * 1000;

/**
 * What one approval records. The digest's meaning depends on the item:
 *
 * - a destination file or skill directory (`unowned`, `owned-edited`,
 *   `unreadable`): the strict approval fingerprint the destination scanner
 *   reported, which the digest-checked repair recomputes under its lock;
 * - `library-clone`: the clone body digest (`CloneEditState.contentDigest`),
 *   which the rebase recomputes immediately before its write;
 * - `agent-source`: `hashContent` of the workspace agent's text, the baseline
 *   the guarded agent writer compares under its destination lock.
 *
 * `null` means the item could not be digested when it was offered (absent or
 * unreadable); such an item can never be replaced.
 */
export interface LocalItemApprovalInput {
  /** Harness root the item lives under (or whose Library holds the clone). */
  harnessRoot: string;
  /** Installer family whose route may replace it; no other family may. */
  family: LocalItemFamily;
  kind: ExternalLocalItemKind;
  /** CLI target of a destination item. Absent for Library clones. */
  target?: HarnessTargetId;
  /** Harness-relative (or Library-relative) POSIX path, for reporting. */
  relPath: string;
  /** Clone kind, for `library-clone` and `agent-source` items. */
  cloneKind?: SkillCloneKind;
  /** Item slug, for `library-clone` and `agent-source` items. */
  slug?: string;
  /** Durable identity of the source that would replace the item (A28). */
  sourceRef: string;
  digest: string | null;
}

export interface LocalItemApproval extends LocalItemApprovalInput {
  approvalId: string;
  createdAt: number;
  expiresAt: number;
}

export interface RegisterApprovalOptions {
  /**
   * How long the approval stays valid. Pass the consent token's remaining
   * lifetime for an install plan; defaults to {@link KEPT_ITEM_APPROVAL_TTL_MS}.
   */
  ttlMs?: number;
}

@injectable()
export class LocalItemApprovals {
  /** Insertion-ordered, so the first key is always the oldest entry. */
  private readonly entries = new Map<string, LocalItemApproval>();

  /** Record `input` and return the id the client may send back. */
  register(
    input: LocalItemApprovalInput,
    options: RegisterApprovalOptions = {},
  ): string {
    const now = Date.now();
    const ttlMs = options.ttlMs ?? KEPT_ITEM_APPROVAL_TTL_MS;
    const approvalId = randomUUID();
    this.pruneExpired(now);
    while (this.entries.size >= MAX_LOCAL_ITEM_APPROVALS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(approvalId, {
      ...input,
      approvalId,
      createdAt: now,
      expiresAt: now + Math.max(0, ttlMs),
    });
    return approvalId;
  }

  /**
   * The approval `approvalId` names, when it is live, belongs to `family` and
   * was issued for `harnessRoot`; otherwise `null`. A mismatch does not
   * consume the entry, so a request from the wrong family cannot cancel the
   * right family's pending decision.
   */
  peek(
    approvalId: string,
    family: LocalItemFamily,
    harnessRoot: string,
  ): LocalItemApproval | null {
    const entry = this.entries.get(approvalId);
    if (entry === undefined) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(approvalId);
      return null;
    }
    if (entry.family !== family || entry.harnessRoot !== harnessRoot) {
      return null;
    }
    return { ...entry };
  }

  /**
   * Like {@link peek}, and removes the entry: an approval authorizes at most
   * one replace attempt. A second decision for the same id reads as unknown.
   */
  take(
    approvalId: string,
    family: LocalItemFamily,
    harnessRoot: string,
  ): LocalItemApproval | null {
    const entry = this.peek(approvalId, family, harnessRoot);
    if (entry !== null) this.entries.delete(approvalId);
    return entry;
  }

  private pruneExpired(now: number): void {
    for (const [id, entry] of this.entries) {
      if (now > entry.expiresAt) this.entries.delete(id);
    }
  }
}
