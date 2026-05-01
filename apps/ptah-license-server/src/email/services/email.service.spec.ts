import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { ResendMailService } from '../providers/resend.provider';

describe('EmailService', () => {
  let service: EmailService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockResend: jest.Mocked<ResendMailService>;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'FROM_EMAIL') return 'help@ptah.live';
        if (key === 'FROM_NAME') return 'Ptah Team';
        return null;
      }),
    } as any;

    mockResend = {
      emails: {
        send: jest
          .fn()
          .mockResolvedValue({ data: { id: 'msg-id' }, error: null }),
      },
    } as any;

    service = new EmailService(mockConfig, mockResend);
  });

  it('sendCustomEmail forwards headers and tags to Resend', async () => {
    const params = {
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<p>Test</p>',
      headers: { 'List-Unsubscribe': '<https://ptah.live/unsub>' },
      tags: [{ name: 'campaignId', value: 'camp-1' }],
    };

    await service.sendCustomEmail(params);

    expect(mockResend.emails.send).toHaveBeenCalledWith({
      from: 'Ptah Team <help@ptah.live>',
      to: ['user@example.com'],
      subject: 'Test Subject',
      html: '<p>Test</p>',
      headers: { 'List-Unsubscribe': '<https://ptah.live/unsub>' },
      tags: [{ name: 'campaignId', value: 'camp-1' }],
    });
  });

  it('retries 3 times on failure and then throws', async () => {
    (mockResend.emails.send as jest.Mock).mockRejectedValue(
      new Error('Resend error'),
    );

    // Speed up tests by mocking sleep
    (service as any).sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.sendCustomEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: 'Test',
      }),
    ).rejects.toThrow('Resend error');

    expect(mockResend.emails.send).toHaveBeenCalledTimes(3);
  });
});
