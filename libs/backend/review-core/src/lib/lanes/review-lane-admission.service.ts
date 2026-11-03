import { inject, injectable } from 'tsyringe';
import { z } from 'zod';

export const REVIEW_LANE_TOKENS = {
  GATEWAY: Symbol.for('ReviewLaneGateway'),
  FILES: Symbol.for('ReviewLaneFiles'),
  CLOCK: Symbol.for('ReviewLaneClock'),
  ADMISSION: Symbol.for('ReviewLaneAdmissionService'),
} as const;

export interface IReviewLaneClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export type AdmissionResult =
  | { status: 'admitted'; release: () => void }
  | { status: 'partial'; reason: 'deadline' | 'budget' | 'review-capacity' | 'operator-reserve' };

/** Singleton shared by all PR workers. No queue: D12 requires immediate partial coverage. */
@injectable()
export class ReviewLaneAdmissionService {
  private active = 0;
  private readonly launchedByPr = new Map<string, number>();

  constructor(@inject(REVIEW_LANE_TOKENS.CLOCK) private readonly clock: IReviewLaneClock) {}

  acquire(prKey: string, deadlineMs: number, maxConcurrentAgents: number): AdmissionResult {
    z.string().min(1).max(512).parse(prKey);
    z.number().int().nonnegative().parse(deadlineMs);
    z.number().int().nonnegative().parse(maxConcurrentAgents);
    if (this.clock.now() >= deadlineMs) return { status: 'partial', reason: 'deadline' };
    if ((this.launchedByPr.get(prKey) ?? 0) >= 6) return { status: 'partial', reason: 'budget' };
    const capacity = Math.min(3, Math.max(0, maxConcurrentAgents - 1));
    if (capacity === 0) return { status: 'partial', reason: 'operator-reserve' };
    if (this.active >= capacity) return { status: 'partial', reason: 'review-capacity' };
    this.active++;
    this.launchedByPr.set(prKey, (this.launchedByPr.get(prKey) ?? 0) + 1);
    let released = false;
    return { status: 'admitted', release: () => {
      if (!released) { this.active--; released = true; }
    } };
  }
}
