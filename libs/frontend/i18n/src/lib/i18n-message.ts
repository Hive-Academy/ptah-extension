/**
 * A user-facing message returned by a service instead of a rendered string.
 *
 * The template that shows it translates `key` with `params`, so the text
 * follows the active language even when the service produced it earlier.
 */
export interface I18nMessage {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
}
