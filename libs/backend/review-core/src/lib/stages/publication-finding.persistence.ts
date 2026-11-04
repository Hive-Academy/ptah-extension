import { ulid } from 'ulid';
import { z } from 'zod';
import { ReviewFindingSchema, type ReviewFinding } from '@ptah-extension/review-contracts';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import type { VerificationResult } from './verification-stage.runner';

const ATTEMPT_SQL = `SELECT repo_id, pr_number, head_sha FROM review_attempts WHERE attempt_id = ?`;
const EXISTING_SQL = `SELECT f.finding_id FROM review_findings f
  INNER JOIN review_finding_events e ON e.finding_id = f.finding_id
  WHERE e.attempt_id = ? AND e.kind = 'accepted' AND f.path = ? AND f.category = ?
    AND json_extract(f.payload_json, '$.lens') = ?
    AND json_extract(f.payload_json, '$.title') = ?
    AND json_extract(f.payload_json, '$.scenario') = ?
    AND json_extract(f.payload_json, '$.line') IS ?`;
const INSERT_FINDING_SQL = `INSERT INTO review_findings (
  finding_id, repo_id, pr_number, path, symbol, category, status, severity, confidence,
  payload_json, first_head_sha, last_head_sha, current_anchor, created_at, updated_at
) VALUES (?, ?, ?, ?, NULL, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`;
const UPDATE_FINDING_SQL = `UPDATE review_findings
  SET severity = ?, confidence = ?, payload_json = ?, last_head_sha = ?, current_anchor = ?, updated_at = ?
  WHERE finding_id = ?`;
const INSERT_EVENT_SQL = `INSERT INTO review_finding_events (event_id, attempt_id, finding_id, kind, created_at)
  VALUES (?, ?, ?, 'accepted', ?)`;

const attemptRow = z.object({
  repo_id: z.string().min(1),
  pr_number: z.number().int().positive(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
}).strict();
const existingRow = z.object({ finding_id: z.string().length(26) }).strict();

/** Accepted verdicts that satisfy the full review finding contract. */
export function verifiedReviewFindings(verdicts: readonly VerificationResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const item of verdicts) {
    if (item.verification !== 'cross-family' && item.verification !== 'same-family-weaker') continue;
    if (item.result.status !== 'completed' || !('verdict' in item.result.output) || item.result.output.verdict !== 'accepted') continue;
    const parsed = ReviewFindingSchema.safeParse({ ...item.finding, verification: item.verification });
    if (!parsed.success) throw new Error('Verified finding failed review schema validation');
    findings.push(parsed.data);
  }
  return findings;
}

/** Writes each verified finding and links it to the attempt. SQL text is static. */
export function persistVerifiedFindings(db: SqliteDatabase, attemptId: string, findings: readonly ReviewFinding[], now = Date.now()): void {
  if (findings.length === 0) return;
  const attempt = attemptRow.safeParse(db.prepare(ATTEMPT_SQL).get(attemptId));
  if (!attempt.success) throw new Error('Review attempt unavailable for finding persistence');
  const existing = db.prepare(EXISTING_SQL);
  const insertFinding = db.prepare(INSERT_FINDING_SQL);
  const updateFinding = db.prepare(UPDATE_FINDING_SQL);
  const insertEvent = db.prepare(INSERT_EVENT_SQL);
  db.transaction(() => {
    findings.forEach((finding, index) => {
      const payload = JSON.stringify(finding);
      const at = now + index;
      const anchor = finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
      const prior = existingRow.safeParse(existing.get(
        attemptId, finding.path, finding.category, finding.lens, finding.title, finding.scenario, finding.line,
      ));
      if (prior.success) {
        updateFinding.run(finding.severity, finding.confidence, payload, attempt.data.head_sha, anchor, at, prior.data.finding_id);
        return;
      }
      const findingId = ulid(at);
      insertFinding.run(
        findingId, attempt.data.repo_id, attempt.data.pr_number, finding.path, finding.category,
        finding.severity, finding.confidence, payload, attempt.data.head_sha, attempt.data.head_sha, anchor, at, at,
      );
      insertEvent.run(ulid(at), attemptId, findingId, at);
    });
  })();
}
