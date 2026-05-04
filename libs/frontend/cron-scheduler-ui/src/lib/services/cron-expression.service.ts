import { Injectable } from '@angular/core';

export interface CronExpressionDescription {
  valid: boolean;
  /** Human-readable summary, e.g. "Every 5 minutes". Empty when invalid. */
  description: string;
  /** Diagnostic message when {@link valid} is false. */
  error?: string;
}

/**
 * CronExpressionService — preview-only cron expression validator and
 * humanizer for the cron scheduler UI.
 *
 * NOTE: This is a CLIENT-SIDE PREVIEW. The backend `cron:create` handler
 * delegates to `croner` for authoritative validation. Anything that passes
 * here but fails on the backend will surface croner's diagnostic verbatim.
 *
 * The implementation intentionally avoids pulling in the `cronstrue`
 * dependency (not in package.json at the time of writing). If/when
 * `cronstrue` is added, swap the {@link describe} body for `cronstrue.toString`.
 */
@Injectable({ providedIn: 'root' })
export class CronExpressionService {
  private static readonly FIELD_RANGES: ReadonlyArray<
    readonly [number, number]
  > = [
    [0, 59], // minute
    [0, 23], // hour
    [1, 31], // day of month
    [1, 12], // month
    [0, 7], // day of week (0 or 7 = Sunday)
  ];

  private static readonly MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  private static readonly WEEKDAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  /**
   * Validate a 5-field cron expression. Accepts the standard subset:
   * `*`, integer literals, ranges (`a-b`), step values (`*\/n`, `a-b/n`),
   * and comma-separated lists.
   */
  public validate(expr: string): { valid: boolean; error?: string } {
    if (typeof expr !== 'string') {
      return { valid: false, error: 'Expression must be a string' };
    }
    const trimmed = expr.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'Expression is empty' };
    }
    const fields = trimmed.split(/\s+/);
    if (fields.length !== 5) {
      return {
        valid: false,
        error: `Expected 5 space-separated fields, got ${fields.length}`,
      };
    }
    for (let i = 0; i < fields.length; i++) {
      const [min, max] = CronExpressionService.FIELD_RANGES[i];
      const fieldErr = this.validateField(fields[i], min, max);
      if (fieldErr) {
        return {
          valid: false,
          error: `Field ${i + 1} ('${fields[i]}'): ${fieldErr}`,
        };
      }
    }
    return { valid: true };
  }

  /**
   * Produce a human-readable description of a cron expression. Recognises
   * a curated set of common shapes; everything else falls back to a
   * generic "At minute X past hour Y" rendering.
   */
  public describe(expr: string): string {
    const v = this.validate(expr);
    if (!v.valid) return '';
    const [minute, hour, dom, month, dow] = expr.trim().split(/\s+/);

    // Every minute: * * * * *
    if (
      minute === '*' &&
      hour === '*' &&
      dom === '*' &&
      month === '*' &&
      dow === '*'
    ) {
      return 'Every minute';
    }

    // Step expressions
    const stepMin = this.parseStep(minute);
    if (
      stepMin !== null &&
      hour === '*' &&
      dom === '*' &&
      month === '*' &&
      dow === '*'
    ) {
      return stepMin === 1 ? 'Every minute' : `Every ${stepMin} minutes`;
    }
    const stepHour = this.parseStep(hour);
    if (
      this.isFixedNumber(minute) &&
      stepHour !== null &&
      dom === '*' &&
      month === '*' &&
      dow === '*'
    ) {
      const m = Number(minute);
      return stepHour === 1
        ? `At minute ${m} of every hour`
        : `At minute ${m}, every ${stepHour} hours`;
    }

    // Hourly: 0 * * * *
    if (
      this.isFixedNumber(minute) &&
      hour === '*' &&
      dom === '*' &&
      month === '*' &&
      dow === '*'
    ) {
      return `Every hour at minute ${Number(minute)}`;
    }

    // Daily: m h * * *
    if (
      this.isFixedNumber(minute) &&
      this.isFixedNumber(hour) &&
      dom === '*' &&
      month === '*' &&
      dow === '*'
    ) {
      return `Every day at ${this.formatHourMinute(Number(hour), Number(minute))}`;
    }

    // Weekday range: m h * * 1-5
    if (
      this.isFixedNumber(minute) &&
      this.isFixedNumber(hour) &&
      dom === '*' &&
      month === '*' &&
      dow === '1-5'
    ) {
      return `At ${this.formatHourMinute(
        Number(hour),
        Number(minute),
      )}, Monday through Friday`;
    }

    // Specific weekday: m h * * d
    if (
      this.isFixedNumber(minute) &&
      this.isFixedNumber(hour) &&
      dom === '*' &&
      month === '*' &&
      this.isFixedNumber(dow)
    ) {
      const d = Number(dow) % 7;
      return `Every ${CronExpressionService.WEEKDAY_NAMES[d]} at ${this.formatHourMinute(
        Number(hour),
        Number(minute),
      )}`;
    }

    // Day of month: m h D * *
    if (
      this.isFixedNumber(minute) &&
      this.isFixedNumber(hour) &&
      this.isFixedNumber(dom) &&
      month === '*' &&
      dow === '*'
    ) {
      return `On day ${Number(dom)} of every month at ${this.formatHourMinute(
        Number(hour),
        Number(minute),
      )}`;
    }

    // Generic fallback
    return `Minute=${minute}, Hour=${hour}, DayOfMonth=${dom}, Month=${month}, DayOfWeek=${dow}`;
  }

  private validateField(
    field: string,
    min: number,
    max: number,
  ): string | null {
    if (field === '*') return null;
    // List
    if (field.includes(',')) {
      for (const part of field.split(',')) {
        const err = this.validateField(part, min, max);
        if (err) return err;
      }
      return null;
    }
    // Step
    if (field.includes('/')) {
      const [range, stepStr] = field.split('/');
      if (range === undefined || stepStr === undefined) {
        return 'malformed step expression';
      }
      const step = Number(stepStr);
      if (!Number.isInteger(step) || step <= 0) {
        return 'step must be a positive integer';
      }
      if (range !== '*') {
        const rangeErr = this.validateField(range, min, max);
        if (rangeErr) return rangeErr;
      }
      return null;
    }
    // Range
    if (field.includes('-')) {
      const [lo, hi] = field.split('-');
      const a = Number(lo);
      const b = Number(hi);
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        return 'range bounds must be integers';
      }
      if (a < min || b > max) {
        return `range ${a}-${b} outside ${min}-${max}`;
      }
      if (a > b) return 'range start greater than end';
      return null;
    }
    // Plain integer
    const n = Number(field);
    if (!Number.isInteger(n)) return 'not an integer';
    if (n < min || n > max) return `value ${n} outside ${min}-${max}`;
    return null;
  }

  private parseStep(field: string): number | null {
    if (!field.startsWith('*/')) return null;
    const n = Number(field.slice(2));
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  private isFixedNumber(field: string): boolean {
    return /^\d+$/.test(field);
  }

  private formatHourMinute(hour: number, minute: number): string {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /** Exposed for completeness; not currently used by the UI. */
  public monthName(monthOneIndexed: number): string {
    return CronExpressionService.MONTH_NAMES[monthOneIndexed - 1] ?? '';
  }
}
