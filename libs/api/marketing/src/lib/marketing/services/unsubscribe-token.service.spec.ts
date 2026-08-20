import { UnsubscribeTokenService } from './unsubscribe-token.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

describe('UnsubscribeTokenService', () => {
  let service: UnsubscribeTokenService;
  let mockConfig: any;
  let mockJwt: any;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn().mockReturnValue('a'.repeat(32)), // 32 bytes secret
    };
    mockJwt = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest
        .fn()
        .mockResolvedValue({ sub: 'user-1', purpose: 'unsubscribe', v: 1 }),
    };
    service = new UnsubscribeTokenService(
      mockConfig as unknown as ConfigService,
      mockJwt as unknown as JwtService,
    );
  });

  it('signs a token with correct payload', async () => {
    const token = await service.sign('user-1');
    expect(token).toBe('signed-token');
    expect(mockJwt.signAsync).toHaveBeenCalledWith(
      { sub: 'user-1', purpose: 'unsubscribe', v: 1 },
      { secret: 'a'.repeat(32) },
    );
  });

  it('verifies a valid token', async () => {
    const userId = await service.verify('valid-token');
    expect(userId).toBe('user-1');
  });

  it('rejects token with wrong purpose', async () => {
    mockJwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'wrong',
      v: 1,
    });
    const userId = await service.verify('invalid-token');
    expect(userId).toBeNull();
  });

  it('rejects token with wrong version', async () => {
    mockJwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'unsubscribe',
      v: 2,
    });
    const userId = await service.verify('invalid-token');
    expect(userId).toBeNull();
  });

  it('throws on init if secret is too short', () => {
    mockConfig.get.mockReturnValue('short');
    const newService = new UnsubscribeTokenService(mockConfig, mockJwt);
    expect(() => newService.onModuleInit()).toThrow(/too short/);
  });
});
