import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { ResendMailService } from '../providers/resend.provider';

/**
 * TASK_2026_201 R3.6 — the founding-cohort welcome mail, gated by test rather
 * than by review.
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL.
 * The mail it guards REPLACED a paid invite that carried a checkout link, a
 * discount percentage, two prices, a money-back promise and renewal pricing.
 * The founding cohort is free, and a single surviving price in a welcome mail
 * tells an approved member they are being asked to pay after they were told
 * they were not. "A reviewer would notice" is not a control — a reviewer
 * noticed nothing for the months both workflows were live at once. A failing
 * test is a control, so the prohibitions below are asserted twice: once on the
 * rendered HTML (what a member reads) and once on the SOURCE TEXT of
 * `email.service.ts` (what a future edit could reintroduce), in the manner of
 * the source-text invariant at `membership.service.spec.ts:120-126`.
 */
describe('EmailService.sendFoundingCohortWelcome (TASK_2026_201 R3)', () => {
  const LICENSE_KEY = 'PTAH-FOUND-1234-5678-ABCD';
  const EXPIRES_AT = new Date('2027-08-11T00:00:00.000Z');

  /** `libs/api/email/src` — this file lives at `src/lib/services`. */
  const EMAIL_SRC_ROOT = join(__dirname, '..', '..');

  let mockResend: jest.Mocked<ResendMailService>;

  /**
   * The `email.service.spec.ts:5-28` harness, with FRONTEND_URL made an
   * argument so R3.4 (the unset-var case) is reachable.
   */
  function buildService(frontendUrl: string | undefined): EmailService {
    const mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'FROM_EMAIL') return 'help@ptah.live';
        if (key === 'FROM_NAME') return 'Ptah Team';
        if (key === 'FRONTEND_URL') return frontendUrl;
        return null;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    return new EmailService(mockConfig, mockResend);
  }

  /** Send once and hand back the exact HTML that went to Resend. */
  async function renderWelcome(options?: {
    frontendUrl?: string | undefined;
    expiresAt?: Date | null;
  }): Promise<string> {
    const service = buildService(
      options && 'frontendUrl' in options
        ? options.frontendUrl
        : 'https://app.example.test',
    );

    // `??` would be wrong here: `null` is a MEANINGFUL value on this parameter
    // (a licence with no end date), not an "unset" one.
    await service.sendFoundingCohortWelcome({
      email: 'founder@example.test',
      licenseKey: LICENSE_KEY,
      expiresAt:
        options && 'expiresAt' in options
          ? (options.expiresAt as Date | null)
          : EXPIRES_AT,
    });

    const send = mockResend.emails.send as jest.Mock;
    expect(send).toHaveBeenCalledTimes(1);
    return (send.mock.calls[0][0] as { html: string }).html;
  }

  beforeEach(() => {
    mockResend = {
      emails: {
        send: jest
          .fn()
          .mockResolvedValue({ data: { id: 'msg-id' }, error: null }),
      },
    } as unknown as jest.Mocked<ResendMailService>;
  });

  describe('the rendered mail says what it must (R3.2, C3)', () => {
    it('is addressed, subjected and sent as exactly one message', async () => {
      const service = buildService('https://app.example.test');

      await service.sendFoundingCohortWelcome({
        email: 'founder@example.test',
        licenseKey: LICENSE_KEY,
        expiresAt: EXPIRES_AT,
      });

      const send = mockResend.emails.send as jest.Mock;
      expect(send).toHaveBeenCalledTimes(1);

      const msg = send.mock.calls[0][0] as {
        from: string;
        to: string[];
        subject: string;
      };
      expect(msg.from).toBe('Ptah Team <help@ptah.live>');
      expect(msg.to).toEqual(['founder@example.test']);
      // States inclusion and freeness; names no price.
      expect(msg.subject).toBe(
        "You're in — Ptah Builders, free for the founding cohort",
      );
    });

    it('carries the licence key and the literal expiry date', async () => {
      const html = await renderWelcome();

      expect(html).toContain(LICENSE_KEY);
      // The `toLocaleDateString('en-US', …)` rendering used by every sibling.
      expect(html).toContain('August 11, 2027');
    });

    it('leads with what the member KEEPS, not with a countdown (C3)', async () => {
      const html = await renderWelcome();

      // The framing the founder settled on at checkpoint 1. Asserted because a
      // later "tighten the copy" pass would otherwise be free to turn a year of
      // retained access back into a two-week deadline.
      expect(html).toContain(
        'Founding members keep the course, the recordings and the community for a full year',
      );
      expect(html).toContain(
        'the two-week cohort is the live part, not the whole of it',
      );

      // Warm at the top, precise at the bottom: the keeps-framing precedes the
      // expiry date in the document, never the other way round.
      expect(html.indexOf('Founding members keep the course')).toBeLessThan(
        html.indexOf('August 11, 2027'),
      );
    });

    it('states the access is free and needs no card, now or later', async () => {
      const html = await renderWelcome();

      expect(html).toMatch(/free/i);
      expect(html).toContain('We have not asked you for a card');
      expect(html).toContain('we will not ask you for one when the cohort');
    });

    it('names what they get and how to get in', async () => {
      const html = await renderWelcome();

      expect(html).toContain('SaaS-building course');
      expect(html).toMatch(/live sessions/i);
      expect(html).toMatch(/community/i);
      expect(html).toMatch(/packs/i);
      expect(html).toContain('this email address');
    });

    it('offers exactly one primary CTA, pointing at the members area', async () => {
      const html = await renderWelcome();

      expect(html).toContain('/members');
      expect(html).toContain(
        '<a class="cta" href="https://app.example.test/members">',
      );
      // One CTA, not a choice of two — a billing-cycle fork is what the deleted
      // invite had, and a second button is how it would grow back.
      expect(html.match(/class="cta"/g)).toHaveLength(1);
    });

    it('renders without an expiry date when the licence has none', async () => {
      const html = await renderWelcome({ expiresAt: null });

      expect(html).toContain(LICENSE_KEY);
      expect(html).toContain('No end date');
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('Invalid Date');
    });
  });

  describe('the rendered mail sells nothing (R3.2)', () => {
    // The exact list from R3.2 / the C3 restatement. `%` is asserted absent
    // OUTRIGHT rather than only next to "off": "a percentage, unless it is a
    // CSS length" is not a rule a regex can hold, and the blanket form costs
    // only the gradient's `0%`/`100%` stops, which are the CSS defaults anyway.
    const PROHIBITED: ReadonlyArray<readonly [string, RegExp]> = [
      ['a pricing-page link', /\/pricing/],
      ['a founding promo parameter', /promo=/],
      ['a Paddle discount parameter', /&d=/],
      ['a percentage', /%/],
      ['a currency amount', /\$/],
      ['the word "discount"', /discount/i],
      ['a money-back promise', /money-?back/i],
      ['renewal language', /renew/i],
    ];

    it.each(PROHIBITED)('contains no %s', async (_label, pattern) => {
      const html = await renderWelcome();
      expect(html).not.toMatch(pattern);
    });

    it('contains none of them in the no-expiry variant either', async () => {
      const html = await renderWelcome({ expiresAt: null });
      for (const [, pattern] of PROHIBITED) {
        expect(html).not.toMatch(pattern);
      }
    });

    it('anti-vacuity: the prohibition patterns do catch the mail they replaced', () => {
      // If a future refactor neuters these regexes, every assertion above would
      // pass on a body full of prices. Prove the patterns still bite by running
      // them against the copy that was actually deleted.
      const deletedInviteCopy =
        '<a href="https://ptah.live/pricing?promo=founding&cycle=yearly&d=dsc_1">' +
        '70% founding discount — $87 for your first year. 30-day money-back ' +
        'guarantee. Renewals are at the list price.';

      for (const [, pattern] of PROHIBITED) {
        expect(deletedInviteCopy).toMatch(pattern);
      }
    });
  });

  describe('configuration is read through ConfigService (R3.4, R3.5)', () => {
    it('falls back to https://ptah.live/members when FRONTEND_URL is unset', async () => {
      const html = await renderWelcome({ frontendUrl: undefined });

      expect(html).toContain('https://ptah.live/members');
      // Not relative, and not a malformed join.
      expect(html).not.toContain('href="/members"');
      expect(html).not.toContain('undefined/members');
      expect(html).toContain(
        '<a class="cta" href="https://ptah.live/members">',
      );
    });

    it('never reaches for process.env', () => {
      const source = readFileSync(join(__dirname, 'email.service.ts'), 'utf8');
      expect(source).not.toContain('process.env');
    });
  });

  describe('the paid invite is gone from the source, not merely unused (R3.1)', () => {
    it('email.service.ts contains none of the deleted symbols or strings', () => {
      const source = readFileSync(join(__dirname, 'email.service.ts'), 'utf8');

      for (const needle of [
        'buildFoundingCheckoutUrl',
        'getFoundingInviteTemplate',
        'sendFoundingInvite',
        'promo=founding',
        'PADDLE_DISCOUNT_ID_BUILDERS_',
      ]) {
        expect(source).not.toContain(needle);
      }
    });

    it('no non-spec source file under libs/api/email carries promo=founding', () => {
      const files = collectTsFiles(EMAIL_SRC_ROOT).filter(
        (file) => !file.endsWith('.spec.ts') && !file.endsWith('.test.ts'),
      );

      // ⚠️ ANTI-VACUITY. A sweep that walks the wrong directory finds zero
      // files and passes forever. Prove the walk found the code before
      // trusting what it says about the code.
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((file) => file.endsWith('email.service.ts'))).toBe(
        true,
      );

      const offenders = files.filter((file) =>
        readFileSync(file, 'utf8').includes('promo=founding'),
      );
      expect(offenders).toEqual([]);
    });
  });
});

/** Every `.ts` file under `dir`, recursively. Absolute paths. */
function collectTsFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }

  return found;
}
