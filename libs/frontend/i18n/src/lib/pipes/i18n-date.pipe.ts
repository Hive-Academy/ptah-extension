import { formatDate } from '@angular/common';
import { inject, Pipe, type PipeTransform } from '@angular/core';
import { I18nService } from '../i18n.service';
import { ANGULAR_LOCALE, type SupportedLang } from '../lang.config';

type DateInput = Date | string | number;

/**
 * Drop-in for Angular's `date` pipe that follows the active language:
 * `{{ createdAt | i18nDate: 'MMM d, y' }}`. Same pattern strings and time
 * zones as `DatePipe`; Arabic keeps Western digits (Angular's `ar` data).
 *
 * Impure so a language switch reformats without re-creating the pipe; the
 * result is memoised on (value, format, timezone, language), so an unchanged
 * input costs a few comparisons per change detection.
 */
@Pipe({ name: 'i18nDate', pure: false })
export class I18nDatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  private memo: {
    value: DateInput;
    format: string;
    timezone: string | undefined;
    lang: SupportedLang;
    result: string | null;
  } | null = null;

  transform(
    value: DateInput,
    format?: string,
    timezone?: string,
  ): string | null;
  transform(value: null | undefined, format?: string, timezone?: string): null;
  transform(
    value: DateInput | null | undefined,
    format?: string,
    timezone?: string,
  ): string | null;
  transform(
    value: DateInput | null | undefined,
    format = 'mediumDate',
    timezone?: string,
  ): string | null {
    // Read first, so the view tracks the language even for an empty value.
    const lang = this.i18n.lang();
    if (value == null || isBlank(value)) return null;

    const memo = this.memo;
    if (
      memo !== null &&
      memo.value === value &&
      memo.format === format &&
      memo.timezone === timezone &&
      memo.lang === lang
    ) {
      return memo.result;
    }
    const result = formatDate(value, format, ANGULAR_LOCALE[lang], timezone);
    this.memo = { value, format, timezone, lang, result };
    return result;
  }
}

/** Besides null and undefined, `''` and NaN format to null, as in Angular's pipe. */
function isBlank(value: DateInput): boolean {
  return value === '' || (typeof value === 'number' && Number.isNaN(value));
}
