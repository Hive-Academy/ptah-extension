import { TemplateRenderService } from './template-render.service';
import { ConfigService } from '@nestjs/config';

describe('TemplateRenderService', () => {
  let service: TemplateRenderService;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MARKETING_POSTAL_ADDRESS') return '123 Main St';
        return null;
      }),
    };
    service = new TemplateRenderService(mockConfig as unknown as ConfigService);
  });

  it('renders and sanitizes correctly', () => {
    const htmlBody =
      '<h1>Hello {{firstName}}</h1><p>Welcome to {{email}}</p><script>alert(1)</script>';
    const result = service.render({
      htmlBody,
      subject: 'Hello {{firstName}}',
      user: { firstName: 'Alice', email: 'alice@example.com' },
      unsubscribeUrl: 'https://ptah.live/unsub',
    });

    expect(result.subject).toBe('Hello Alice');
    expect(result.html).toContain('<h1>Hello Alice</h1>');
    expect(result.html).toContain('<p>Welcome to alice@example.com</p>');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('123 Main St');
    expect(result.html).toContain('https://ptah.live/unsub');
  });

  it('sanitizeForStorage throws on diff', () => {
    const htmlBody = '<p>Test</p><script>bad</script>';
    expect(() => service.sanitizeForStorage(htmlBody)).toThrow();
  });

  it('sanitizeForStorage accepts clean HTML', () => {
    const htmlBody = '<p>Test</p>';
    const sanitized = service.sanitizeForStorage(htmlBody);
    expect(sanitized).toBe(htmlBody);
  });
});
