import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import {
  CandidateFindingSchema,
  IdentityVerdictSchema,
  ReviewFindingSchema,
  type CandidateFinding,
  type IdentityVerdict,
  type ReviewFinding,
} from '@ptah-extension/review-contracts';
import {
  FindingIdentityService,
  type PriorFindingIdentity,
} from './finding-identity.service';
import {
  FindingRecheckService,
  type FindingRecheckInput,
} from './finding-recheck.service';

const publicationRow = z.object({
  publication_id: z.string(),
  state: z.enum(['planned', 'inflight', 'confirmed', 'unknown']),
  github_id: z.string().nullable(),
  request_hash: z.string(),
});
const priorRow = z.object({
  finding_id: z.string(),
  path: z.string(),
  symbol_id: z.string().nullable(),
  category: z.string(),
  status: z.enum(['open', 'addressed', 'reopened', 'disputed']),
});
const attemptRow = z.object({
  repo_id: z.string(),
  pr_number: z.number().int().positive(),
  head_sha: z.string(),
});
const semanticRelation = z
  .object({
    relation: z.enum(['same', 'distinct', 'uncertain']),
    priorFindingId: z
      .string()
      .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.relation === 'same') !== (value.priorFindingId !== null))
      context.addIssue({
        code: 'custom',
        message: 'Identity prior ID does not match relation',
      });
  });
export type PublicationKind = 'walkthrough' | 'review' | 'follow_up';
export interface PublicationIntent {
  attemptId: string;
  kind: PublicationKind;
  key: string;
  body: string;
  marker: string;
  findingId?: string;
}
export interface StoredPublication {
  id: string;
  state: 'planned' | 'inflight' | 'confirmed' | 'unknown';
  githubId: string | null;
}

/** Synchronous SQLite operations; callers serialize the asynchronous GitHub mutation per PR. */
export class PublicationOutboxRepository {
  findingStatus(
    findingId: string,
  ): 'open' | 'addressed' | 'reopened' | 'disputed' | null {
    const row = this.db
      .prepare('SELECT status FROM review_findings WHERE finding_id = ?')
      .get(findingId);
    return row
      ? z.object({ status: priorRow.shape.status }).parse(row).status
      : null;
  }

  hasConfirmedFinding(findingId: string): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM review_publications WHERE state = 'confirmed'
      AND (finding_id = ? OR (kind = 'review' AND instr(marker, ?) > 0)) LIMIT 1`,
      )
      .get(findingId, `<!-- ptah-review:finding:${findingId} -->`);
  }

  confirmFindingMarkers(
    publicationId: string,
    findingIds: readonly string[],
  ): void {
    const markers = [...new Set(findingIds)]
      .map((id) => `<!-- ptah-review:finding:${id} -->`)
      .join('\n');
    if (markers)
      this.db
        .prepare(
          `UPDATE review_publications SET marker = marker || char(10) || ?, updated_at = ?
      WHERE publication_id = ? AND kind = 'review' AND state = 'confirmed'`,
        )
        .run(markers, Date.now(), publicationId);
  }

  pendingFollowUp(
    attemptId: string,
    findingId: string,
  ): 'addressed' | 'reopened' | null {
    // Match on the attempt's head, not its id: a manual retryHead/rerun gets a new attempt id
    // for the same head, and the unconfirmed follow-up row keeps the id of the attempt that planned it.
    const row = this.db
      .prepare(
        `SELECT p.marker FROM review_publications p
      JOIN review_attempts a ON a.repo_id = p.repo_id AND a.pr_number = p.pr_number AND a.head_sha = p.head_sha
      WHERE a.attempt_id = ? AND p.finding_id = ? AND p.kind = 'follow_up' AND p.state != 'confirmed'
      LIMIT 1`,
      )
      .get(attemptId, findingId);
    if (!row) return null;
    const marker = z.object({ marker: z.string() }).parse(row).marker;
    return marker.includes(':addressed:')
      ? 'addressed'
      : marker.includes(':reopened:')
        ? 'reopened'
        : null;
  }
  constructor(private readonly db: SqliteDatabase) {}

  shortlistForVerifier(
    attemptId: string,
    findingInput: CandidateFinding,
  ): { id: string; failureMode: string }[] {
    const finding = CandidateFindingSchema.parse(findingInput);
    return this.db.transaction(() => {
      const attempt = attemptRow.parse(
        this.db
          .prepare(
            'SELECT repo_id, pr_number, head_sha FROM review_attempts WHERE attempt_id = ?',
          )
          .get(attemptId),
      );
      const rows = this.db
        .prepare(
          `SELECT finding_id, failure_mode FROM review_findings
        WHERE repo_id = ? AND pr_number = ? AND path = ? AND category = ?
        AND (? IS NULL OR symbol_id = ? OR symbol_id IS NULL)
        ORDER BY created_at DESC LIMIT 20`,
        )
        .all(
          attempt.repo_id,
          attempt.pr_number,
          finding.path,
          finding.category,
          finding.affectedCaller,
          finding.affectedCaller,
        );
      return rows.map((row) => {
        const parsed = z
          .object({
            finding_id: z.string(),
            failure_mode: z.string().nullable(),
          })
          .parse(row);
        return {
          id: parsed.finding_id,
          failureMode: (parsed.failure_mode ?? '').slice(0, 300),
        };
      });
    })();
  }

  recordVerifierIdentity(
    attemptId: string,
    candidateId: string,
    finding: ReviewFinding,
    semanticInput: unknown,
    verifierFamily: string,
  ): IdentityVerdict {
    return this.db.transaction(() => {
      const verdict = this.proposeIdentity(
        attemptId,
        candidateId,
        finding,
        semanticInput,
      );
      const attempt = attemptRow.parse(
        this.db
          .prepare(
            'SELECT repo_id, pr_number, head_sha FROM review_attempts WHERE attempt_id = ?',
          )
          .get(attemptId),
      );
      const evidence = JSON.stringify(verdict.evidence);
      this.db
        .prepare(
          `INSERT INTO review_identity_matches (attempt_id, candidate_id, prior_finding_id, relation,
        evidence_json, evidence_hash, verifier_family, created_at, source_head_sha, lens_family, suppression_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, candidate_id) DO NOTHING`,
        )
        .run(
          attemptId,
          candidateId,
          verdict.priorFindingId,
          verdict.relation,
          evidence,
          createHash('sha256').update(evidence).digest('hex'),
          verifierFamily,
          Date.now(),
          attempt.head_sha,
          finding.lens,
          verdict.relation === 'uncertain' ? 'identity-uncertain' : null,
        );
      return verdict;
    })();
  }

  /** Exact behavior evidence can reuse an identity; ambiguous matches remain local. */
  proposeIdentity(
    attemptId: string,
    candidateId: string,
    finding: ReviewFinding,
    semanticInput?: unknown,
  ): IdentityVerdict {
    const attempt = attemptRow.parse(
      this.db
        .prepare(
          'SELECT repo_id, pr_number, head_sha FROM review_attempts WHERE attempt_id = ?',
        )
        .get(attemptId),
    );
    const rows = this.db
      .prepare(
        `SELECT finding_id, failure_mode, affected_behavior FROM review_findings
      WHERE repo_id = ? AND pr_number = ? AND path = ? AND category = ? AND (? IS NULL OR symbol_id = ? OR symbol_id IS NULL)
      ORDER BY created_at DESC LIMIT 100`,
      )
      .all(
        attempt.repo_id,
        attempt.pr_number,
        finding.path,
        finding.category,
        finding.affectedCaller,
        finding.affectedCaller,
      );
    const schema = z.object({
      finding_id: z.string(),
      failure_mode: z.string().nullable(),
      affected_behavior: z.string().nullable(),
    });
    const matches = rows
      .map((row) => schema.parse(row))
      .filter(
        (row) =>
          row.failure_mode === finding.failureMode &&
          row.affected_behavior === finding.affectedBehavior,
      );
    const staged =
      semanticInput === undefined
        ? z
            .object({
              relation: z.enum(['same', 'distinct', 'uncertain']),
              prior_finding_id: z.string().nullable(),
              evidence_json: z.string(),
            })
            .safeParse(
              this.db
                .prepare(
                  `SELECT relation,
      prior_finding_id, evidence_json FROM review_identity_matches WHERE attempt_id = ? AND candidate_id = ?`,
                )
                .get(attemptId, candidateId),
            )
        : null;
    const stagedEvidence = staged?.success
      ? z
          .object({ reason: z.string() })
          .safeParse(JSON.parse(staged.data.evidence_json))
      : null;
    const input =
      staged?.success && stagedEvidence?.success
        ? {
            relation: staged.data.relation,
            priorFindingId: staged.data.prior_finding_id,
            reason: stagedEvidence.data.reason,
          }
        : semanticInput;
    const semantic = semanticRelation.safeParse(input);
    const relation =
      matches.length === 1
        ? 'same'
        : semantic.success
          ? semantic.data.relation
          : 'uncertain';
    const priorFindingId =
      matches.length === 1
        ? matches[0].finding_id
        : semantic.success
          ? semantic.data.priorFindingId
          : null;
    return IdentityVerdictSchema.parse({
      candidateId,
      priorFindingId,
      relation,
      evidence: {
        path: finding.path,
        symbol: finding.affectedCaller ?? finding.path,
        behavior: finding.affectedBehavior,
        reason:
          matches.length === 1
            ? 'Same failure mode and affected behavior'
            : semantic.success
              ? semantic.data.reason
              : 'Verifier identity relation missing or invalid',
      },
    });
  }

  suppress(
    attemptId: string,
    candidateId: string,
    finding: ReviewFinding,
    reason: string,
    verifierFamily: string,
  ): void {
    const attempt = attemptRow.parse(
      this.db
        .prepare(
          'SELECT repo_id, pr_number, head_sha FROM review_attempts WHERE attempt_id = ?',
        )
        .get(attemptId),
    );
    const evidence = JSON.stringify({ path: finding.path, reason });
    this.db
      .prepare(
        `INSERT INTO review_identity_matches (attempt_id, candidate_id, prior_finding_id, relation,
      evidence_json, evidence_hash, verifier_family, created_at, source_head_sha, lens_family, suppression_reason)
      VALUES (?, ?, NULL, 'uncertain', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attempt_id, candidate_id) DO UPDATE SET suppression_reason = excluded.suppression_reason`,
      )
      .run(
        attemptId,
        candidateId,
        evidence,
        createHash('sha256').update(evidence).digest('hex'),
        verifierFamily,
        Date.now(),
        attempt.head_sha,
        finding.lens,
        reason,
      );
  }

  identity(
    attemptId: string,
    findingInput: ReviewFinding,
    verdictInput: unknown,
    verifierFamily: string,
    recheckInput?: FindingRecheckInput,
  ): { findingId: string | null; outcome: string } {
    const finding = ReviewFindingSchema.parse(findingInput);
    const verdict = IdentityVerdictSchema.parse(verdictInput);
    const identity = new FindingIdentityService();
    const recheck = new FindingRecheckService();
    return this.db.transaction(() => {
      const attempt = attemptRow.parse(
        this.db
          .prepare(
            'SELECT repo_id, pr_number, head_sha FROM review_attempts WHERE attempt_id = ?',
          )
          .get(attemptId),
      );
      const rows = this.db
        .prepare(
          `SELECT finding_id, path, symbol_id, category, status FROM review_findings
        WHERE repo_id = ? AND pr_number = ? AND path = ? AND category = ? AND (? IS NULL OR symbol_id = ? OR symbol_id IS NULL)
        ORDER BY created_at DESC LIMIT 100`,
        )
        .all(
          attempt.repo_id,
          attempt.pr_number,
          finding.path,
          finding.category,
          finding.affectedCaller,
          finding.affectedCaller,
        );
      const priors: PriorFindingIdentity[] = rows.map((row) => {
        const prior = priorRow.parse(row);
        return {
          findingId: prior.finding_id,
          path: prior.path,
          symbol: prior.symbol_id,
          category: finding.category,
          status: prior.status,
        };
      });
      const decision = identity.decide(
        {
          candidateId: verdict.candidateId,
          finding,
          symbol: finding.affectedCaller,
        },
        priors,
        verdict,
      );
      const now = Date.now();
      const evidence = JSON.stringify(verdict.evidence);
      const evidenceHash = createHash('sha256').update(evidence).digest('hex');
      this.db
        .prepare(
          `INSERT INTO review_identity_matches (attempt_id, candidate_id, prior_finding_id, relation,
        evidence_json, evidence_hash, verifier_family, created_at, source_head_sha, lens_family, suppression_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, candidate_id) DO NOTHING`,
        )
        .run(
          attemptId,
          verdict.candidateId,
          verdict.priorFindingId,
          verdict.relation,
          evidence,
          evidenceHash,
          verifierFamily,
          now,
          attempt.head_sha,
          finding.lens,
          decision.kind === 'uncertain' ? 'identity-uncertain' : null,
        );
      if (decision.kind === 'uncertain')
        return { findingId: null, outcome: 'uncertain' };
      const anchor =
        finding.line === null
          ? finding.path
          : `${finding.path}:${finding.line}`;
      if (decision.kind === 'new') {
        this.db
          .prepare(
            `INSERT INTO review_findings (finding_id, repo_id, pr_number, path, symbol_id, category, status,
          severity, confidence, payload_json, first_head_sha, last_head_sha, current_anchor, created_at, updated_at,
          failure_mode, affected_behavior) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            decision.findingId,
            attempt.repo_id,
            attempt.pr_number,
            finding.path,
            finding.affectedCaller,
            finding.category,
            finding.severity,
            finding.confidence,
            JSON.stringify(finding),
            attempt.head_sha,
            attempt.head_sha,
            anchor,
            now,
            now,
            finding.failureMode,
            finding.affectedBehavior,
          );
      } else {
        this.db
          .prepare(
            `UPDATE review_findings SET severity = ?, confidence = ?, payload_json = ?, last_head_sha = ?,
          current_anchor = ?, updated_at = ? WHERE finding_id = ?`,
          )
          .run(
            finding.severity,
            finding.confidence,
            JSON.stringify(finding),
            attempt.head_sha,
            anchor,
            now,
            decision.findingId,
          );
      }
      const prior = priors.find(
        (item) => item.findingId === decision.findingId,
      );
      const outcome =
        recheckInput && prior
          ? recheckInput.status === prior.status
            ? recheck.decide(recheckInput)
            : 'uncertain'
          : decision.kind === 'new'
            ? 'new'
            : prior?.status === 'addressed'
              ? recheck.decide({
                  findingId: decision.findingId,
                  status: 'addressed',
                  headSha: attempt.head_sha,
                  checkedHeadSha: attempt.head_sha,
                  verdict: 'still_present',
                  identity: verdict,
                  failurePathEvidence: finding.failureMode,
                })
              : 'still_open';
      if (outcome === 'addressed' || outcome === 'reopened') {
        this.plan({
          attemptId,
          kind: 'follow_up',
          key: decision.findingId,
          findingId: decision.findingId,
          marker: `<!-- ptah-review:${outcome}:${decision.findingId} -->`,
          body: outcome,
        });
        this.db
          .prepare(
            `UPDATE review_findings SET status = ?, addressed_at = ?, reopened_at = ? WHERE finding_id = ?`,
          )
          .run(
            outcome,
            outcome === 'addressed' ? now : null,
            outcome === 'reopened' ? now : null,
            decision.findingId,
          );
      }
      const eventKind =
        outcome === 'addressed' || outcome === 'reopened'
          ? outcome
          : 'accepted';
      this.db
        .prepare(
          `INSERT INTO review_finding_events (event_id, attempt_id, finding_id, kind, created_at, evidence_json, source_head_sha)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attempt_id, finding_id, kind) DO NOTHING`,
        )
        .run(
          ulid(now),
          attemptId,
          decision.findingId,
          eventKind,
          now,
          evidence,
          attempt.head_sha,
        );
      return { findingId: decision.findingId, outcome };
    })();
  }

  plan(input: PublicationIntent): StoredPublication {
    return this.db.transaction((): StoredPublication => {
      const attempt = attemptRow.parse(
        this.db
          .prepare(
            'SELECT repo_id, pr_number, head_sha FROM review_attempts WHERE attempt_id = ?',
          )
          .get(input.attemptId),
      );
      const hash = createHash('sha256').update(input.body).digest('hex');
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO review_publications (publication_id, repo_id, pr_number, head_sha, attempt_id,
        kind, publication_key, github_id, state, request_hash, marker, created_at, updated_at, finding_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'planned', ?, ?, ?, ?, ?)
        ON CONFLICT(repo_id, pr_number, head_sha, kind, publication_key) DO NOTHING`,
        )
        .run(
          ulid(now),
          attempt.repo_id,
          attempt.pr_number,
          attempt.head_sha,
          input.attemptId,
          input.kind,
          input.key,
          hash,
          input.marker,
          now,
          now,
          input.findingId ?? null,
        );
      const row = publicationRow.parse(
        this.db
          .prepare(
            `SELECT publication_id, state, github_id, request_hash FROM review_publications
        WHERE repo_id = ? AND pr_number = ? AND head_sha = ? AND kind = ? AND publication_key = ?`,
          )
          .get(
            attempt.repo_id,
            attempt.pr_number,
            attempt.head_sha,
            input.kind,
            input.key,
          ),
      );
      if (
        row.request_hash !== hash &&
        (input.kind === 'walkthrough' || row.state !== 'confirmed')
      ) {
        this.db
          .prepare(
            `UPDATE review_publications SET request_hash = ?, state = 'planned', updated_at = ? WHERE publication_id = ?`,
          )
          .run(hash, now, row.publication_id);
        return {
          id: row.publication_id,
          state: 'planned',
          githubId: row.github_id,
        };
      }
      if (row.request_hash !== hash)
        throw new Error(
          'Confirmed publication body differs from requested body',
        );
      return {
        id: row.publication_id,
        state: row.state,
        githubId: row.github_id,
      };
    })();
  }

  state(
    id: string,
    state: 'inflight' | 'unknown' | 'confirmed',
    githubId?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE review_publications SET state = ?, github_id = COALESCE(?, github_id), updated_at = ?,
      last_reconciled_at = CASE WHEN ? = 'confirmed' THEN ? ELSE last_reconciled_at END WHERE publication_id = ?`,
      )
      .run(state, githubId ?? null, Date.now(), state, Date.now(), id);
  }
}
