/**
 * Raised when ~/.ptah/settings.json cannot be written (full disk, missing
 * permission, a file lock held by antivirus or a sync client).
 *
 * Carries only the filesystem error code and fixed text: never the setting
 * key's value, never the file path, never the underlying message.
 */
export class SettingsPersistError extends Error {
  override readonly name = 'SettingsPersistError';

  constructor(readonly code: string) {
    super(`Settings could not be saved to disk (${code})`);
  }
}
