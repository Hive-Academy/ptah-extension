import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import {
  createTestingNestModule,
  type TestingModule,
} from '../../testing/nest-module-builder';
import {
  createMockPrisma,
  type MockPrisma,
} from '../../testing/mock-prisma.factory';
import { EmailService } from '../../email/services/email.service';
import { TrialReminderService } from './trial-reminder.service';

/**
 * Unit tests for TrialReminderService (TASK_2025_294 W1.B5.1).
 *
 * Covers:
 *  - Reminder firing at T-3d and T-1d windows (and auto-downgrade at T-0).
 *  - Non-firing at unrelated windows (T-2d, T+1d relative to trial end).
 *  - Idempotency: second invocation at same wall-clock does not re-send
 *    (Prisma filter excludes users with an existing trialReminder row;
 *    re-running at the same frozen instant with an updated findMany stub
 *    returns zero eligible subscriptions).
 *  - Restart resilience: after a "restart" (new service + new module, same
 *    DB state mock), pending reminders are still processed.
 *  - Edge case: trial extended after T-3d reminder sent — T-1d reminder
 *    still fires because each reminder type is tracked independently.
 *
 * The cron `@Cron('0 9 * * *')` decorator is not exercised directly; we
 * invoke `triggerManually()` (the documented hook for tests) which calls
 * `handleTrialReminders()` with the frozen clock in place.
 */

type EmailMock = {
  [K in
    | 'sendTrialReminder7Day'
    | 'sendTrialReminder3Day'
    | 'sendTrialReminder1Day'
    | 'sendTrialExpired'
    | 'sendTrialDowngradedToCommunity']: jest.Mock;
};

function createMockEmailService(): EmailMock {
  return {
    sendTrialReminder7Day: jest.fn().mockResolvedValue(undefined),
    sendTrialReminder3Day: jest.fn().mockResolvedValue(undefined),
    sendTrialReminder1Day: jest.fn().mockResolvedValue(undefined),
    sendTrialExpired: jest.fn().mockResolvedValue(undefined),
    sendTrialDowngradedToCommunity: jest.fn().mockResolvedValue(undefined),
  };
}

interface UserFixture {
  id: string;
  email: string;
  firstName: string | null;
  licenses: Array<{ id: string; status: string; plan: string }>;
}

interface SubFixture {
  id: string;
  userId: string;
  status: string;
  priceId: string;
  trialEnd: Date | null;
  user: UserFixture;
}

function makeUser(overrides: Partial<UserFixture> = {}): UserFixture {
  return {
    id: overrides.id ?? 'user-1',
    email: overrides.email ?? 'alice@example.com',
    firstName: overrides.firstName ?? 'Alice',
    licenses: overrides.licenses ?? [
      { id: 'lic-1', status: 'active', plan: 'pro' },
    ],
  };
}

function makeSubscription(
  overrides: Partial<SubFixture> & { trialEnd: Date | null },
): SubFixture {
  const user = overrides.user ?? makeUser();
  return {
    id: overrides.id ?? 'sub-1',
    userId: overrides.userId ?? user.id,
    status: overrides.status ?? 'trialing',
    priceId: overrides.priceId ?? 'pro_monthly',
    trialEnd: overrides.trialEnd,
    user,
  };
}

/**
 * Configure the Prisma mock so its model methods return per-call values
 * that reflect the state of the "database" for a given trial reminder run.
 *
 * - `downgradeCandidates` feeds the first `subscription.findMany` call
 *   (the expired-trial downgrade sweep at step 1).
 * - `reminderQueue` maps reminder type → list of eligible subscriptions for
 *   the subsequent three `subscription.findMany` calls (1_day, 3_day, 7_day
 *   in the service's evaluation order).
 */
function primeFindMany(
  prisma: MockPrisma,
  opts: {
    downgradeCandidates: SubFixture[];
    reminderQueue: {
      '1_day': SubFixture[];
      '3_day': SubFixture[];
      '7_day': SubFixture[];
    };
  },
): void {
  // Service order: downgrade sweep → 1_day → 3_day → 7_day.
  prisma.subscription.findMany
    .mockResolvedValueOnce(opts.downgradeCandidates)
    .mockResolvedValueOnce(opts.reminderQueue['1_day'])
    .mockResolvedValueOnce(opts.reminderQueue['3_day'])
    .mockResolvedValueOnce(opts.reminderQueue['7_day']);
}

describe('TrialReminderService', () => {
  let module: TestingModule;
  let prisma: MockPrisma;
  let email: EmailMock;
  let service: TrialReminderService;
  let clock: FrozenClock;

  /** Trial ends on 2026-05-04T12:00:00Z. */
  const TRIAL_END = new Date('2026-05-04T12:00:00Z');

  /** Helper: build an ISO instant N full days before TRIAL_END at 09:00 UTC. */
  function dayMinusAt9am(daysBefore: number): Date {
    // Target date calendar day = TRIAL_END calendar day - daysBefore.
    const d = new Date(TRIAL_END);
    d.setUTCDate(d.getUTCDate() - daysBefore);
    d.setUTCHours(9, 0, 0, 0);
    return d;
  }

  async function bootstrap(): Promise<void> {
    prisma = createMockPrisma();
    email = createMockEmailService();
    prisma.trialReminder.create.mockResolvedValue({ id: 'tr-1' });
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.subscription.update.mockResolvedValue({ id: 'sub-1' });
    prisma.license.update.mockResolvedValue({ id: 'lic-1' });

    const built = await createTestingNestModule({
      providers: [
        TrialReminderService,
        { provide: EmailService, useValue: email },
      ],
      prisma,
    });
    module = built.module;
    service = module.get(TrialReminderService);
  }

  afterEach(() => {
    clock?.restore();
    jest.clearAllMocks();
  });

  describe('reminder firing windows', () => {
    it('fires 3_day reminder at T-3d window and does not call other reminder emails', async () => {
      clock = freezeTime(dayMinusAt9am(3));
      await bootstrap();

      const sub = makeSubscription({ trialEnd: TRIAL_END });
      primeFindMany(prisma, {
        downgradeCandidates: [],
        reminderQueue: { '1_day': [], '3_day': [sub], '7_day': [] },
      });

      await service.triggerManually();

      expect(email.sendTrialReminder3Day).toHaveBeenCalledTimes(1);
      expect(email.sendTrialReminder3Day).toHaveBeenCalledWith({
        email: 'alice@example.com',
        firstName: 'Alice',
        trialEnd: TRIAL_END,
      });
      expect(email.sendTrialReminder1Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder7Day).not.toHaveBeenCalled();
      expect(email.sendTrialExpired).not.toHaveBeenCalled();
      expect(email.sendTrialDowngradedToCommunity).not.toHaveBeenCalled();

      // Idempotency record written with reminderType '3_day'.
      expect(prisma.trialReminder.create).toHaveBeenCalledWith({
        data: {
          userId: sub.userId,
          reminderType: '3_day',
          emailSentTo: sub.user.email,
        },
      });
    });

    it('fires 1_day reminder at T-1d window', async () => {
      clock = freezeTime(dayMinusAt9am(1));
      await bootstrap();

      const sub = makeSubscription({ trialEnd: TRIAL_END });
      primeFindMany(prisma, {
        downgradeCandidates: [],
        reminderQueue: { '1_day': [sub], '3_day': [], '7_day': [] },
      });

      await service.triggerManually();

      expect(email.sendTrialReminder1Day).toHaveBeenCalledTimes(1);
      expect(email.sendTrialReminder3Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder7Day).not.toHaveBeenCalled();
    });

    it('auto-downgrades expired trials at T-0 instead of sending an expired email', async () => {
      // T-0: trial has just ended. Freeze one minute after TRIAL_END so the
      // `trialEnd < now` filter in downgradeExpiredTrials matches.
      clock = freezeTime(new Date(TRIAL_END.getTime() + 60_000));
      await bootstrap();

      const expiredSub = makeSubscription({ trialEnd: TRIAL_END });
      primeFindMany(prisma, {
        downgradeCandidates: [expiredSub],
        reminderQueue: { '1_day': [], '3_day': [], '7_day': [] },
      });

      await service.triggerManually();

      // Downgrade path: license updated, 'expired' reminder row written,
      // "welcome to community" email sent. No trial-reminder emails fire.
      expect(email.sendTrialDowngradedToCommunity).toHaveBeenCalledTimes(1);
      expect(email.sendTrialReminder1Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder3Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder7Day).not.toHaveBeenCalled();
      expect(email.sendTrialExpired).not.toHaveBeenCalled();

      const reminderCreateCalls = prisma.trialReminder.create.mock.calls.map(
        (c) => (c[0] as { data: { reminderType: string } }).data.reminderType,
      );
      expect(reminderCreateCalls).toContain('expired');
    });

    it('does not fire any reminder at T-2d window when queue is empty', async () => {
      // At T-2d, the Prisma filter returns empty arrays for all reminder
      // types (no subscription has trialEnd on T-2d+1=T-1d, T-2d+3=T+1d, or
      // T-2d+7=T+5d). Asserting our mock is consistent with service filters.
      clock = freezeTime(dayMinusAt9am(2));
      await bootstrap();

      primeFindMany(prisma, {
        downgradeCandidates: [],
        reminderQueue: { '1_day': [], '3_day': [], '7_day': [] },
      });

      await service.triggerManually();

      expect(email.sendTrialReminder1Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder3Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder7Day).not.toHaveBeenCalled();
      expect(email.sendTrialExpired).not.toHaveBeenCalled();
      expect(email.sendTrialDowngradedToCommunity).not.toHaveBeenCalled();
      expect(prisma.trialReminder.create).not.toHaveBeenCalled();
    });

    it('does not fire reminder emails at T+1d (trial already expired → downgrade branch)', async () => {
      // At T+1d: trial ended 1 day ago. Subscription status is still
      // 'trialing' until the downgrade sweep expires it — it lands in the
      // downgrade list, not any reminder list.
      clock = freezeTime(dayMinusAt9am(-1));
      await bootstrap();

      const expiredSub = makeSubscription({ trialEnd: TRIAL_END });
      primeFindMany(prisma, {
        downgradeCandidates: [expiredSub],
        reminderQueue: { '1_day': [], '3_day': [], '7_day': [] },
      });

      await service.triggerManually();

      expect(email.sendTrialReminder1Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder3Day).not.toHaveBeenCalled();
      expect(email.sendTrialReminder7Day).not.toHaveBeenCalled();
      expect(email.sendTrialDowngradedToCommunity).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency', () => {
    it('second invocation at same timestamp does not re-send when reminder already recorded', async () => {
      clock = freezeTime(dayMinusAt9am(3));
      await bootstrap();

      const sub = makeSubscription({ trialEnd: TRIAL_END });

      // First run: reminder eligible, fires once.
      primeFindMany(prisma, {
        downgradeCandidates: [],
        reminderQueue: { '1_day': [], '3_day': [sub], '7_day': [] },
      });
      await service.triggerManually();
      expect(email.sendTrialReminder3Day).toHaveBeenCalledTimes(1);

      // Second run at same instant: Prisma query excludes the user because
      // `user.trialReminders.none.reminderType` now matches the 3_day row
      // we wrote. Mock returns empty for every reminder window.
      primeFindMany(prisma, {
        downgradeCandidates: [],
        reminderQueue: { '1_day': [], '3_day': [], '7_day': [] },
      });
      await service.triggerManually();

      // Email count unchanged — no duplicate send.
      expect(email.sendTrialReminder3Day).toHaveBeenCalledTimes(1);
    });
  });

  describe('restart resilience', () => {
    it('picks up pending reminders on boot (new service instance, persisted DB state)', async () => {
      clock = freezeTime(dayMinusAt9am(3));
      await bootstrap();

      // Pretend prior process crashed before sending. Pending reminder is
      // still in the "DB" — the fresh mock returns it on first findMany.
      const pendingSub = makeSubscription({
        id: 'sub-pending',
        trialEnd: TRIAL_END,
        user: makeUser({
          id: 'user-2',
          email: 'bob@example.com',
          firstName: 'Bob',
        }),
      });
      primeFindMany(prisma, {
        downgradeCandidates: [],
        reminderQueue: { '1_day': [], '3_day': [pendingSub], '7_day': [] },
      });

      // "Restart": rebuild the module + service; prisma + email persist (DB
      // is the source of truth) but service state is fresh.
      const built = await createTestingNestModule({
        providers: [
          TrialReminderService,
          { provide: EmailService, useValue: email },
        ],
        prisma,
      });
      const rebooted =
        built.module.get<TrialReminderService>(TrialReminderService);

      await rebooted.triggerManually();

      expect(email.sendTrialReminder3Day).toHaveBeenCalledTimes(1);
      expect(email.sendTrialReminder3Day).toHaveBeenCalledWith({
        email: 'bob@example.com',
        firstName: 'Bob',
        trialEnd: TRIAL_END,
      });
    });
  });

  describe('trial extension edge case', () => {
    it('fires 1_day reminder even after 3_day reminder already sent (independent tracking per reminder type)', async () => {
      // Scenario: user was at T-3d, received 3_day reminder. Trial was then
      // extended — or time simply advanced to T-1d — and user still has a
      // trialing subscription. 1_day reminder must still fire because the
      // Prisma filter for `1_day` eligibility checks only the `1_day`
      // reminder row (not the already-present `3_day` one).
      clock = freezeTime(dayMinusAt9am(1));
      await bootstrap();

      const sub = makeSubscription({ trialEnd: TRIAL_END });
      // findMany for `1_day` returns the user because no `1_day` row exists
      // yet (the prior `3_day` row does not disqualify per-type filter).
      primeFindMany(prisma, {
        downgradeCandidates: [],
        reminderQueue: { '1_day': [sub], '3_day': [], '7_day': [] },
      });

      await service.triggerManually();

      expect(email.sendTrialReminder1Day).toHaveBeenCalledTimes(1);
      expect(email.sendTrialReminder1Day).toHaveBeenCalledWith({
        email: 'alice@example.com',
        firstName: 'Alice',
        trialEnd: TRIAL_END,
      });
      expect(email.sendTrialReminder3Day).not.toHaveBeenCalled();

      // New row recorded specifically for `1_day`.
      expect(prisma.trialReminder.create).toHaveBeenCalledWith({
        data: {
          userId: sub.userId,
          reminderType: '1_day',
          emailSentTo: sub.user.email,
        },
      });
    });
  });
});
