import { ReviewLaneAdmissionService, type IReviewLaneClock } from './review-lane-admission.service';

const clock: IReviewLaneClock = { now: () => 0, setTimeout, clearTimeout };

describe('ReviewLaneAdmissionService', () => {
  it('reserves one operator slot and caps review concurrency at three', () => {
    const admission = new ReviewLaneAdmissionService(clock);
    expect(admission.acquire('a', 100, 1)).toMatchObject({ status: 'partial', reason: 'operator-reserve' });
    const leases = [0, 1, 2].map(() => admission.acquire('a', 100, 10));
    expect(leases.map((lease) => lease.status)).toEqual(['admitted', 'admitted', 'admitted']);
    expect(admission.acquire('b', 100, 10)).toMatchObject({ status: 'partial', reason: 'review-capacity' });
    leases.forEach((lease) => { if (lease.status === 'admitted') lease.release(); });
  });

  it('caps each PR at six launches and rejects expired deadlines', () => {
    const admission = new ReviewLaneAdmissionService(clock);
    for (let i = 0; i < 6; i++) {
      const lease = admission.acquire('a', 100, 5);
      expect(lease.status).toBe('admitted');
      if (lease.status === 'admitted') lease.release();
    }
    expect(admission.acquire('a', 100, 5)).toMatchObject({ status: 'partial', reason: 'budget' });
    expect(admission.acquire('b', 0, 5)).toMatchObject({ status: 'partial', reason: 'deadline' });
  });
});
