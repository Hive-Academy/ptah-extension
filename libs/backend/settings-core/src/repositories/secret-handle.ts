/**
 * SecretHandle — typed accessor for a single secret setting.
 *
 * Analogous to SettingHandle but routes through the ISettingsStore secret
 * methods (readSecret / writeSecret / deleteSecret) rather than the global
 * setting path.
 *
 * The type parameter T is constrained to string because secrets are always
 * stored and returned as strings (cipher text or opaque blobs).
 */
export interface SecretHandle {
  /**
   * Read the current secret value. Returns undefined if never written.
   * Always async — secret stores require I/O.
   */
  get(): Promise<string | undefined>;

  /**
   * Persist a new secret value.
   * Callers pass the raw value; the adapter layer handles encryption.
   */
  set(value: string): Promise<void>;

  /** Remove the secret from secure storage. */
  delete(): Promise<void>;
}
