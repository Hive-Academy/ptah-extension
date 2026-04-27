import { LicenseService } from '../services/license.service';
import { EmailService } from '../../email/services/email.service';
import { CreateLicenseDto } from '../dto/create-license.dto';
import { AdminController } from './admin.controller';

/**
 * Unit tests for AdminController (TASK_2025_294 W1.B4).
 *
 * Strategy: instantiate the controller directly with mocked LicenseService
 * and EmailService. The AdminApiKeyGuard is a separate concern covered in
 * `admin-api-key.guard.spec.ts`; these tests exercise the controller's
 * business logic only (create license → conditional email → response
 * shaping).
 *
 * Contract under test:
 *   - Happy path: creates license and sends email (emailSent: true)
 *   - Email failure: still returns success=true with emailError populated
 *     (graceful degradation — license must persist even if email fails)
 *   - sendEmail=false: skips email, emailSent=false, no emailError
 *   - License key NEVER appears in the response body (security invariant)
 *   - LicenseService is called with the exact { email, plan } params
 */

describe('AdminController', () => {
  let licenseService: jest.Mocked<LicenseService>;
  let emailService: jest.Mocked<EmailService>;
  let controller: AdminController;

  const baseDto: CreateLicenseDto = {
    email: 'user@example.com',
    plan: 'pro',
  };

  beforeEach(() => {
    licenseService = {
      createLicense: jest.fn(),
    } as unknown as jest.Mocked<LicenseService>;
    emailService = {
      sendLicenseKey: jest.fn(),
    } as unknown as jest.Mocked<EmailService>;
    controller = new AdminController(licenseService, emailService);
  });

  describe('POST /api/v1/admin/licenses (createLicense)', () => {
    it('happy path: creates license, sends email, and returns success response without the key', async () => {
      const expiresAt = new Date('2026-06-01T00:00:00Z');
      licenseService.createLicense.mockResolvedValueOnce({
        licenseKey: 'ptah_lic_' + 'a'.repeat(64),
        expiresAt,
      });
      emailService.sendLicenseKey.mockResolvedValueOnce(undefined);

      const result = await controller.createLicense(baseDto);

      // LicenseService invoked with DTO shape (no extra fields).
      expect(licenseService.createLicense).toHaveBeenCalledWith({
        email: 'user@example.com',
        plan: 'pro',
      });

      // Email delivered with the generated key (internal), not the DTO's absent key.
      expect(emailService.sendLicenseKey).toHaveBeenCalledWith({
        email: 'user@example.com',
        licenseKey: 'ptah_lic_' + 'a'.repeat(64),
        plan: 'pro',
        expiresAt,
      });

      // Response shape.
      expect(result).toEqual({
        success: true,
        license: {
          email: 'user@example.com',
          plan: 'pro',
          status: 'active',
          expiresAt: expiresAt.toISOString(),
          createdAt: expect.any(String),
        },
        emailSent: true,
        emailError: undefined,
      });

      // SECURITY: license key must NEVER leak into the HTTP response.
      expect(JSON.stringify(result)).not.toContain('ptah_lic_');
    });

    it('handles null expiresAt from LicenseService (community never-expiring plan)', async () => {
      licenseService.createLicense.mockResolvedValueOnce({
        licenseKey: 'ptah_lic_' + 'b'.repeat(64),
        expiresAt: null,
      });

      const result = await controller.createLicense({
        email: 'free@example.com',
        plan: 'community',
      });

      expect(result.license.expiresAt).toBeNull();
      expect(emailService.sendLicenseKey).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: null }),
      );
      expect(result.emailSent).toBe(true);
    });

    it('graceful degradation: returns success=true with emailError when email send fails', async () => {
      licenseService.createLicense.mockResolvedValueOnce({
        licenseKey: 'ptah_lic_' + 'c'.repeat(64),
        expiresAt: new Date('2026-06-01T00:00:00Z'),
      });
      emailService.sendLicenseKey.mockRejectedValueOnce(
        new Error('Resend rate limit exceeded'),
      );

      const result = await controller.createLicense(baseDto);

      // License persisted regardless of email failure.
      expect(licenseService.createLicense).toHaveBeenCalledTimes(1);

      expect(result.success).toBe(true);
      expect(result.emailSent).toBe(false);
      expect(result.emailError).toBe('Resend rate limit exceeded');

      // Still no key leak even when email failed.
      expect(JSON.stringify(result)).not.toContain('ptah_lic_');
    });

    it('captures "Unknown email error" when email throws a non-Error value', async () => {
      licenseService.createLicense.mockResolvedValueOnce({
        licenseKey: 'ptah_lic_' + 'd'.repeat(64),
        expiresAt: null,
      });
      emailService.sendLicenseKey.mockRejectedValueOnce('string rejection');

      const result = await controller.createLicense(baseDto);

      expect(result.success).toBe(true);
      expect(result.emailSent).toBe(false);
      expect(result.emailError).toBe('Unknown email error');
    });

    it('skips email when sendEmail=false and does not populate emailError', async () => {
      licenseService.createLicense.mockResolvedValueOnce({
        licenseKey: 'ptah_lic_' + 'e'.repeat(64),
        expiresAt: null,
      });

      const result = await controller.createLicense({
        ...baseDto,
        sendEmail: false,
      });

      expect(emailService.sendLicenseKey).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.emailSent).toBe(false);
      expect(result.emailError).toBeUndefined();
    });

    it('defaults to sending email when sendEmail is omitted (undefined)', async () => {
      licenseService.createLicense.mockResolvedValueOnce({
        licenseKey: 'ptah_lic_' + 'f'.repeat(64),
        expiresAt: null,
      });

      await controller.createLicense({
        email: 'user@example.com',
        plan: 'community',
      });

      expect(emailService.sendLicenseKey).toHaveBeenCalledTimes(1);
    });

    it('propagates LicenseService errors (e.g. DB failure) without catching them', async () => {
      // If license creation fails, we do NOT want graceful degradation —
      // the caller must see the error so they can retry.
      licenseService.createLicense.mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      await expect(controller.createLicense(baseDto)).rejects.toThrow(
        'DB connection lost',
      );
      expect(emailService.sendLicenseKey).not.toHaveBeenCalled();
    });

    it('response includes ISO-8601 createdAt timestamp', async () => {
      licenseService.createLicense.mockResolvedValueOnce({
        licenseKey: 'ptah_lic_' + 'g'.repeat(64),
        expiresAt: null,
      });

      const before = Date.now();
      const result = await controller.createLicense({
        email: 'user@example.com',
        plan: 'community',
      });
      const after = Date.now();

      const createdAtMs = Date.parse(result.license.createdAt);
      expect(createdAtMs).toBeGreaterThanOrEqual(before);
      expect(createdAtMs).toBeLessThanOrEqual(after);
    });
  });
});
