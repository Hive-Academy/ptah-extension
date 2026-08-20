/**
 * Unit tests for `CircleProvider` — the thin, typed Circle Admin API client.
 *
 * Focus: the guarantees callers rely on —
 *   1. Feature-off mode (missing token / community id) makes no network call.
 *   2. The client NEVER throws — non-2xx, timeouts and transport errors all
 *      fold into `{ ok: false, error }`.
 *   3. Member-id extraction copes with the various Circle response shapes.
 *
 * `global.fetch` is mocked so no real HTTP traffic is generated.
 */

import { ConfigService } from '@nestjs/config';
import { CircleProvider } from './circle.provider';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest
      .fn()
      .mockResolvedValue(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const FULL_CONFIG = {
  CIRCLE_API_TOKEN: 'tok_123',
  CIRCLE_COMMUNITY_ID: 'comm_1',
  CIRCLE_DEFAULT_SPACE_GROUP_ID: 'sg_1',
};

describe('CircleProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isEnabled', () => {
    it('is true only when token AND community id are present', () => {
      expect(new CircleProvider(makeConfig(FULL_CONFIG)).isEnabled()).toBe(
        true,
      );
    });

    it('is false when the token is missing', () => {
      const provider = new CircleProvider(
        makeConfig({ CIRCLE_COMMUNITY_ID: 'comm_1' }),
      );
      expect(provider.isEnabled()).toBe(false);
    });

    it('is false when the community id is missing', () => {
      const provider = new CircleProvider(
        makeConfig({ CIRCLE_API_TOKEN: 'tok_123' }),
      );
      expect(provider.isEnabled()).toBe(false);
    });

    it('treats blank/whitespace config values as unset', () => {
      const provider = new CircleProvider(
        makeConfig({ CIRCLE_API_TOKEN: '   ', CIRCLE_COMMUNITY_ID: 'comm_1' }),
      );
      expect(provider.isEnabled()).toBe(false);
    });
  });

  describe('inviteMember', () => {
    it('returns { skipped } without calling fetch when feature-off', async () => {
      const provider = new CircleProvider(makeConfig({}));
      const result = await provider.inviteMember('a@e.com', 'Ann');
      expect(result).toEqual({ ok: false, skipped: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts email + community_id + optional name/space_group and returns the member id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, { id: 4242 }));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.inviteMember('a@e.com', 'Ann');

      expect(result).toEqual({ ok: true, status: 201, memberId: '4242' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/community_members');
      const sentBody = JSON.parse((init as RequestInit).body as string);
      expect(sentBody).toEqual({
        email: 'a@e.com',
        community_id: 'comm_1',
        name: 'Ann',
        space_group_id: 'sg_1',
      });
    });

    it('omits name and space_group_id when not provided/configured', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: 'm1' }));
      const provider = new CircleProvider(
        makeConfig({
          CIRCLE_API_TOKEN: 'tok_123',
          CIRCLE_COMMUNITY_ID: 'comm_1',
        }),
      );

      const result = await provider.inviteMember('a@e.com');

      expect(result).toEqual({ ok: true, status: 200, memberId: 'm1' });
      const sentBody = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(sentBody).toEqual({ email: 'a@e.com', community_id: 'comm_1' });
    });

    it('folds a non-2xx response into { ok: false, error }', async () => {
      fetchMock.mockResolvedValue(jsonResponse(422, undefined));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.inviteMember('a@e.com');

      expect(result).toEqual({
        ok: false,
        status: 422,
        error: 'Circle API returned status 422',
      });
    });

    it('returns ok with an undefined member id when the body has no id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { unrelated: true }));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.inviteMember('a@e.com');

      expect(result).toEqual({ ok: true, status: 200, memberId: undefined });
    });
  });

  describe('removeMember', () => {
    it('returns { skipped } without calling fetch when feature-off', async () => {
      const provider = new CircleProvider(makeConfig({}));
      const result = await provider.removeMember('m1');
      expect(result).toEqual({ ok: false, skipped: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deletes by numeric member id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(204, undefined));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.removeMember('4242');

      expect(result).toEqual({ ok: true, status: 204 });
      expect(fetchMock.mock.calls[0][0]).toContain('community_member_id=4242');
    });

    it('deletes by email when the identifier looks like an email', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, undefined));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      await provider.removeMember('a@e.com');

      expect(fetchMock.mock.calls[0][0]).toContain(
        `email=${encodeURIComponent('a@e.com')}`,
      );
    });

    it('folds a non-2xx delete into { ok: false, error }', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, undefined));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.removeMember('m1');

      expect(result).toEqual({
        ok: false,
        status: 404,
        error: 'Circle API returned status 404',
      });
    });
  });

  describe('transport failures never throw', () => {
    it('maps an AbortError to a timeout message', async () => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      fetchMock.mockRejectedValue(abort);
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.inviteMember('a@e.com');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('surfaces a generic Error message', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.inviteMember('a@e.com');

      expect(result).toMatchObject({ ok: false, error: 'ECONNRESET' });
    });

    it('handles a non-Error rejection', async () => {
      fetchMock.mockRejectedValue('boom');
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.removeMember('m1');

      expect(result).toMatchObject({
        ok: false,
        error: 'Unknown Circle API transport error',
      });
    });
  });

  describe('member id extraction from varied shapes', () => {
    it.each([
      [{ id: 'str-id' }, 'str-id'],
      [{ id: 99 }, '99'],
      [{ community_member_id: 'cmid' }, 'cmid'],
      [{ member: { id: 7 } }, '7'],
    ])('extracts %j -> %s', async (body, expected) => {
      fetchMock.mockResolvedValue(jsonResponse(200, body));
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.inviteMember('a@e.com');

      expect(result.memberId).toBe(expected);
    });

    it('returns undefined when the success body is not valid JSON', async () => {
      const badResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('<<not json>>'),
      } as unknown as Response;
      fetchMock.mockResolvedValue(badResponse);
      const provider = new CircleProvider(makeConfig(FULL_CONFIG));

      const result = await provider.inviteMember('a@e.com');

      expect(result).toEqual({ ok: true, status: 200, memberId: undefined });
    });
  });
});
