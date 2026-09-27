import { formatNumber } from '@angular/common';
import { inject, Pipe, type PipeTransform } from '@angular/core';
import { I18nError } from '../i18n.error';
import { I18nService } from '../i18n.service';
import { ANGULAR_LOCALE, type SupportedLang } from '../lang.config';

type NumberInput = number | string;

/**
 * Drop-in for Angular's `number` pipe that follows the active language:
 * `{{ rating | i18nNumber: '1.0-1' }}`. Same `digitsInfo` as `DecimalPipe`;
 * Arabic keeps Western digits (Angular's `ar` data).
 *
 * Impure and memoised on (value, digitsInfo, language), like `I18nDatePipe`.
 */
@Pipe({ name: 'i18nNumber', pure: false })
export class I18nNumberPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  private memo: {
    value: NumberInput;
    digitsInfo: string | undefined;
    lang: SupportedLang;
    result: string;
  } | null = null;

  transform(value: NumberInput, digitsInfo?: string): string | null;
  transform(value: null | undefined, digitsInfo?: string): null;
  transform(
    value: NumberInput | null | undefined,
    digitsInfo?: string,
  ): string | null;
  transform(
    value: NumberInput | null | undefined,
    digitsInfo?: string,
  ): string | null {
    // Read first, so the view tracks the language even for an empty value.
    const lang = this.i18n.lang();
    if (value == null || isBlank(value)) return null;

    const memo = this.memo;
    if (
      memo !== null &&
      memo.value === value &&
      memo.digitsInfo === digitsInfo &&
      memo.lang === lang
    ) {
      return memo.result;
    }
    const result = formatNumber(
      toNumber(value),
      ANGULAR_LOCALE[lang],
      digitsInfo,
    );
    this.memo = { value, digitsInfo, lang, result };
    return result;
  }
}

/** `DecimalPipe`'s coercion: numeric strings convert, anything else throws. */
function toNumber(value: NumberInput): number {
  if (typeof value === 'number') return value;
  if (!isNaN(Number(value) - parseFloat(value))) return Number(value);
  throw new I18nError(`[i18n] i18nNumber: "${value}" is not a number.`);
}

/** Besides null and undefined, `''` and NaN format to null, as in Angular's pipe. */
function isBlank(value: NumberInput): boolean {
  return value === '' || (typeof value === 'number' && Number.isNaN(value));
}
