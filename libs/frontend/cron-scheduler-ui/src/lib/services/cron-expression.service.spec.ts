import { CronExpressionService } from './cron-expression.service';

describe('CronExpressionService', () => {
  let svc: CronExpressionService;

  beforeEach(() => {
    svc = new CronExpressionService();
  });

  describe('validate — valid expressions', () => {
    const valid = [
      '* * * * *',
      '0 * * * *',
      '*/5 * * * *',
      '0 9 * * 1-5',
      '0 0 1 * *',
      '0 0 * * 0',
      '15 14 1 * *',
      '*/2 * * * *',
      '0 22 * * 1-5',
      '23 0-23/2 * * *',
    ];

    for (const expr of valid) {
      it(`accepts "${expr}"`, () => {
        const v = svc.validate(expr);
        expect(v.valid).toBe(true);
        expect(v.error).toBeUndefined();
      });
    }
  });

  describe('validate — invalid expressions', () => {
    it('rejects expression with too few fields', () => {
      const v = svc.validate('* * * *');
      expect(v.valid).toBe(false);
      expect(v.error).toMatch(/5/);
    });

    it('rejects out-of-range minute', () => {
      const v = svc.validate('60 * * * *');
      expect(v.valid).toBe(false);
      expect(v.error).toMatch(/0-59|outside/);
    });

    it('rejects empty expression', () => {
      const v = svc.validate('   ');
      expect(v.valid).toBe(false);
    });

    it('rejects non-integer step', () => {
      const v = svc.validate('*/abc * * * *');
      expect(v.valid).toBe(false);
    });
  });

  describe('describe', () => {
    it('humanizes "* * * * *"', () => {
      expect(svc.describe('* * * * *')).toBe('Every minute');
    });

    it('humanizes "*/5 * * * *"', () => {
      expect(svc.describe('*/5 * * * *')).toBe('Every 5 minutes');
    });

    it('humanizes "0 * * * *"', () => {
      expect(svc.describe('0 * * * *')).toMatch(/Every hour at minute 0/);
    });

    it('humanizes "0 9 * * 1-5"', () => {
      expect(svc.describe('0 9 * * 1-5')).toMatch(/09:00.*Monday.*Friday/);
    });

    it('humanizes "0 0 * * 0" as Sunday', () => {
      expect(svc.describe('0 0 * * 0')).toMatch(/Sunday/);
    });

    it('humanizes "0 0 1 * *" as day 1', () => {
      expect(svc.describe('0 0 1 * *')).toMatch(/day 1/);
    });

    it('returns empty string for invalid expression', () => {
      expect(svc.describe('60 * * * *')).toBe('');
    });
  });
});
