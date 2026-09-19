export const SALIENCE_RANK_HALF_LIFE_MS = 604_800_000;
export const SALIENCE_USE_WEIGHT = 0.3;
export const SALIENCE_USE_SATURATION = 3;
export const SALIENCE_PIN_BONUS = 1;

export interface SalienceRankRow {
  readonly salience: number;
  readonly hits: number;
  readonly pinned: boolean | number;
  readonly lastUsedAt: number;
}

export function baseSalience(hint: number, boost = 0): number {
  const value = hint + boost;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function rankSalience(row: SalienceRankRow, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - row.lastUsedAt);
  const hits = Math.max(0, row.hits);
  return (
    row.salience *
      (SALIENCE_RANK_HALF_LIFE_MS / (SALIENCE_RANK_HALF_LIFE_MS + ageMs)) +
    (SALIENCE_USE_WEIGHT * hits) / (hits + SALIENCE_USE_SATURATION) +
    (row.pinned ? SALIENCE_PIN_BONUS : 0)
  );
}

export function salienceRankExpression(placeholder: '?' | '@rankNow'): string {
  if (placeholder === '?') {
    return '(m.salience * (604800000.0 / (604800000.0 + MAX(0, ? - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned)';
  }
  return '(m.salience * (604800000.0 / (604800000.0 + MAX(0, @rankNow - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned)';
}

export function salienceRankOrderBy(placeholder: '?' | '@rankNow'): string {
  return `ORDER BY ${salienceRankExpression(placeholder)} DESC, m.id DESC`;
}
