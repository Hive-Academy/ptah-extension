/**
 * License Fetcher
 *
 * Library-internal helper that fetches and verifies license status for
 * {@link LicenseService}.
 *
 * Responsibilities:
 * - Resolve the license server URL (config override or environment default)
 * - POST the license key to the server's `/api/v1/licenses/verify` endpoint
 * - Verify the Ed25519 signature on the response (MITM protection)
 *
 * This helper is **library-internal** — it is not `@injectable()` and is not
 * exported from the public barrel. {@link LicenseService} owns a single
 * instance that is constructed in its constructor.
 *
 * @packageDocumentation
 */

import type * as vscode from 'vscode';
import axios from 'axios';
import { createPublicKey, verify, KeyObject } from 'crypto';
import {
  resolveEnvironment,
  LICENSE_PUBLIC_KEY_BASE64,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import type { ConfigManager } from '../../config/config-manager';
import type { LicenseStatus } from './license-types';

/**
 * Network timeout for license verification (ms). Kept in sync with the
 * original {@link LicenseService.NETWORK_TIMEOUT_MS} constant.
 */
const NETWORK_TIMEOUT_MS = 5000;

/**
 * Result of a license fetch. Discriminated by `ok`.
 * - `ok: true`: the server returned a verified status (signature checked if a
 *   public key is configured)
 * - `ok: false`: the call failed (network or signature) — caller decides
 *   whether to fall back to a cache
 */
export type FetchResult =
  | { ok: true; status: LicenseStatus }
  | { ok: false; error: Error };

/**
 * Fetches and verifies license status from the license server.
 *
 * Preserves the exact I/O + crypto behaviour of the original
 * {@link LicenseService}. All error-message strings, log lines, and
 * retry/throw semantics are byte-identical.
 */
export class LicenseFetcher {
  /**
   * Cached Ed25519 public key for verifying license server response signatures.
   * `null` means signing verification is disabled (placeholder key).
   */
  private publicKey: KeyObject | null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
    private readonly configManager: ConfigManager,
  ) {
    this.publicKey = this.loadPublicKey();
  }

  /**
   * Resolve the license server URL.
   *
   * Priority:
   * 1. Setting `ptah.apiUrl` (manual override via ConfigManager)
   * 2. Environment-based: localhost:3000 in dev, api.ptah.live in production
   */
  get licenseServerUrl(): string {
    const settingOverride = this.configManager.get<string>('apiUrl');
    if (settingOverride) {
      return settingOverride;
    }

    // extensionMode: 2 = Development (matches vscode.ExtensionMode.Development)
    const isDev = this.context.extensionMode === 2;
    return resolveEnvironment(isDev).urls.API_URL;
  }

  /**
   * Whether the public key is configured (and therefore signature verification
   * is mandatory on responses).
   */
  get hasPublicKey(): boolean {
    return this.publicKey !== null;
  }

  /**
   * POST the license key to the server and return the parsed status.
   *
   * On success, the response signature is verified when a public key is
   * configured. On any failure (network or signature), an axios error is
   * re-thrown with the byte-identical `License verification failed: ...`
   * message used historically so error breadcrumbs in Sentry stay stable.
   *
   * @param licenseKey - The license key to verify
   */
  async fetchLicenseStatus(licenseKey: string): Promise<LicenseStatus> {
    try {
      const { data: responseJson } = await axios.post<
        LicenseStatus & { signature?: string }
      >(
        `${this.licenseServerUrl}/api/v1/licenses/verify`,
        { licenseKey },
        { timeout: NETWORK_TIMEOUT_MS },
      );

      // Verify response signature to prevent MITM attacks.
      // Extract signature before creating the LicenseStatus object.
      const { signature: responseSignature, ...licenseData } = responseJson;
      if (this.publicKey) {
        // When a real public key is configured, signature is mandatory
        if (!responseSignature) {
          throw new Error(
            'License response missing required signature — possible tampering',
          );
        }
        if (!this.verifySignature(licenseData, responseSignature)) {
          this.logger.error(
            '[LicenseService.verifyLicense] License response signature verification failed - possible MITM attack',
          );
          throw new Error(
            'License response signature verification failed — possible tampering',
          );
        }
        this.logger.debug(
          '[LicenseService.verifyLicense] Response signature verified successfully',
        );
      }

      return licenseData as LicenseStatus;
    } catch (fetchError) {
      if (axios.isAxiosError(fetchError) && fetchError.response) {
        const bodySnippet =
          typeof fetchError.response.data === 'string'
            ? fetchError.response.data.substring(0, 200)
            : JSON.stringify(fetchError.response.data).substring(0, 200);
        throw new Error(
          `License verification failed: ${fetchError.response.status} ${fetchError.response.statusText} — ${bodySnippet}`,
        );
      }
      throw fetchError;
    }
  }

  /**
   * Load the Ed25519 public key from the embedded constant for signature
   * verification.
   *
   * @returns KeyObject for Ed25519 verification, or null if key is invalid
   */
  private loadPublicKey(): KeyObject | null {
    try {
      return createPublicKey({
        key: Buffer.from(LICENSE_PUBLIC_KEY_BASE64, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch (error) {
      this.logger.error(
        '[LicenseService] Failed to load Ed25519 public key for signature verification',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  /**
   * Verify the Ed25519 signature of a license server response.
   *
   * Prevents MITM attacks by verifying that the response was signed by the
   * license server's private key.
   *
   * Verification is graceful:
   * - If no public key is configured (placeholder), returns true (skip verification)
   * - If no signature is present in the response, returns true (server not updated yet)
   * - Only rejects if a signature IS present but IS INVALID
   *
   * @param payload - The response data (without the signature field)
   * @param signature - The base64-encoded Ed25519 signature
   * @returns true if signature is valid or verification is skipped
   */
  private verifySignature(payload: object, signature: string): boolean {
    if (!this.publicKey) {
      // Public key not configured (placeholder) - skip verification
      return true;
    }
    try {
      const data = JSON.stringify(payload, Object.keys(payload).sort());
      return verify(
        null,
        Buffer.from(data),
        this.publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch (error) {
      this.logger.error('[LicenseService] Signature verification error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
