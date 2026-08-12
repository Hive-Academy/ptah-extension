import { memberSessionRequestSchema } from '@ptah-contracts/community';

import {
  toMemberSessionRequest,
  type RequestWithRequester,
} from './session-requests.service';

/**
 * 🔴 NFR-S4 — EXIT-GATE CLAUSE 4, AS AN EXECUTABLE ARTEFACT.
 *
 * "`MemberSessionRequest` never carries `calendarEventId`, `paymentStatus`,
 * `paddleTransactionId`, `isFreeSession` or any requester identity."
 *
 * ⚠️ THE ASSERTION IS ON THE OBJECT'S **OWN KEYS**, NOT ON THE VALUES BEING
 * `undefined` — and the difference is the whole point. `expect(out.userId)
 * .toBeUndefined()` passes for an object that HAS a `userId` key holding
 * `undefined`, and `JSON.stringify` would drop it, so the test would be green
 * for a mapper that is one line away from serialising it. `Object.keys` cannot
 * be satisfied that way. Same shape as `MemberPack`'s `notes` assertion.
 *
 * ⚠️ THE ROW IS FULLY POPULATED, DELIBERATELY. A fixture whose forbidden columns
 * are already `null` proves nothing: every one of them below carries a real,
 * distinctive value, so a leak shows up as that value in the output rather than
 * as a null nobody notices.
 *
 * ⚠️ THIS FILE SITS BESIDE THE SERVICE, NOT INSIDE ITS SPEC. The mapper is the
 * chokepoint clause 4 names; giving it a file of its own is what makes
 * "somebody deleted the field-absence test" a visible act rather than a diff
 * inside a 900-line spec.
 */

const ROW: RequestWithRequester = {
  id: 'req_1',
  // ── every one of these must NOT appear on the member shape ──────────────
  userId: 'ffffffff-1111-2222-3333-444444444444',
  isFreeSession: true,
  paymentStatus: 'completed',
  paddleTransactionId: 'txn_01hxyzLEAKED',
  calendarEventId: 'a1b2c3d4LEAKED',
  updatedAt: new Date('2026-08-08T13:00:00.000Z'),
  user: {
    id: 'ffffffff-1111-2222-3333-444444444444',
    email: 'requester@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  // ── the nine that must ──────────────────────────────────────────────────
  sessionTopicId: 'architecture-review',
  additionalNotes: 'Module boundaries, please.',
  status: 'scheduled',
  scheduledAt: new Date('2026-08-12T15:00:00.000Z'),
  durationMinutes: 60,
  meetLink: 'https://meet.google.com/xyz-abcd-efg',
  declineReason: null,
  createdAt: new Date('2026-08-08T12:00:00.000Z'),
};

/** The nine fields `MemberSessionRequest` declares, in declaration order. */
const MEMBER_FIELDS = [
  'id',
  'sessionTopicId',
  'additionalNotes',
  'status',
  'scheduledAt',
  'durationMinutes',
  'meetLink',
  'declineReason',
  'createdAt',
] as const;

/**
 * Everything on the row that a member must never receive, with the reason.
 *
 * Kept as DATA so a failure names the field AND says why it matters, and so a
 * new admin-only column added to `SessionRequest` has an obvious place to be
 * listed.
 */
const FORBIDDEN: ReadonlyArray<{ key: string; why: string }> = [
  {
    key: 'userId',
    why: 'requester identity — the member already knows who they are, and the shape has no requester field precisely so it cannot carry somebody else',
  },
  {
    key: 'user',
    why: 'the joined requester projection — an email address on a member-facing response',
  },
  {
    key: 'isFreeSession',
    why: 'billing internal (R4.10)',
  },
  {
    key: 'paymentStatus',
    why: 'billing internal (R4.10)',
  },
  {
    key: 'paddleTransactionId',
    why: 'a payment-system identifier in a browser network tab (R4.10)',
  },
  {
    key: 'calendarEventId',
    why: 'an internal Google handle. The member needs meetLink, which is the thing they click; the event id grants nothing and names an internal record',
  },
  {
    key: 'updatedAt',
    why: 'not on the contract — a row-maintenance timestamp no member surface renders',
  },
];

describe('🔴 NFR-S4 — toMemberSessionRequest is the field-absence chokepoint', () => {
  const mapped = toMemberSessionRequest(ROW);

  it('returns EXACTLY the nine MemberSessionRequest fields as own keys', () => {
    expect(Object.keys(mapped).sort()).toEqual([...MEMBER_FIELDS].sort());
  });

  it.each(FORBIDDEN.map((f) => [f.key, f.why] as const))(
    'has no own key `%s` — %s',
    (key) => {
      expect(Object.prototype.hasOwnProperty.call(mapped, key)).toBe(false);
    },
  );

  it('leaks none of the forbidden VALUES anywhere in the serialised body', () => {
    // The belt to the own-keys braces: a mapper that renamed `calendarEventId`
    // to `eventRef` would pass the key assertions and fail this one.
    const body = JSON.stringify(mapped);
    for (const secret of [
      ROW.userId,
      ROW.paddleTransactionId,
      ROW.calendarEventId,
      ROW.user.email,
      ROW.user.firstName,
    ]) {
      expect(body).not.toContain(secret);
    }
    // …and `isFreeSession: true` / `paymentStatus: 'completed'` are absent as
    // values too, checked separately because `true` is not a distinctive string.
    expect(body).not.toContain('isFreeSession');
    expect(body).not.toContain('completed');
  });

  it('still carries every field the member DOES need', () => {
    expect(mapped).toEqual({
      id: 'req_1',
      sessionTopicId: 'architecture-review',
      additionalNotes: 'Module boundaries, please.',
      status: 'scheduled',
      scheduledAt: '2026-08-12T15:00:00.000Z',
      durationMinutes: 60,
      meetLink: 'https://meet.google.com/xyz-abcd-efg',
      declineReason: null,
      createdAt: '2026-08-08T12:00:00.000Z',
    });
  });

  it("satisfies the contract's own runtime schema", () => {
    // The contract ships a Zod schema for the client's boundary parse. Running
    // the SERVER's output through it is what proves the two halves agree —
    // a `satisfies z.ZodType<T>` only proves the schema matches the TYPE.
    expect(() => memberSessionRequestSchema.parse(mapped)).not.toThrow();
  });

  it('the fixture is not vacuous — every forbidden column really is populated', () => {
    // 🔴 WITHOUT THIS, A FIXTURE THAT HAPPENED TO CARRY NULLS WOULD MAKE EVERY
    // ASSERTION ABOVE PASS AGAINST A MAPPER THAT LEAKS ALL OF THEM.
    const row = ROW as unknown as Record<string, unknown>;
    for (const { key } of FORBIDDEN) {
      expect({
        key,
        populated: row[key] !== null && row[key] !== undefined,
      }).toEqual({ key, populated: true });
    }
  });

  it('is an explicit object literal, not a spread-minus-a-few-keys', () => {
    // ⚠️ THE PROPERTY THAT MAKES THIS CONTRACT SURVIVE THE NEXT MIGRATION. A
    // `const { userId, ...rest } = row` mapper would ADD every future column to
    // the member response automatically, which is the opposite of what a
    // field-absence contract means. A row carrying an unknown extra column is
    // the cheapest way to assert the shape is closed.
    const withFutureColumn = {
      ...ROW,
      someColumnMigrationFiveAdds: 'must-not-appear',
    } as unknown as RequestWithRequester;

    expect(
      Object.keys(toMemberSessionRequest(withFutureColumn)).sort(),
    ).toEqual([...MEMBER_FIELDS].sort());
  });
});
