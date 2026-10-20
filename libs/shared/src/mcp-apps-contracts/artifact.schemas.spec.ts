import {
  ARTIFACT_HEIGHT_MAX,
  ARTIFACT_HEIGHT_MIN,
  ARTIFACT_MAX_BYTES,
  ArtifactHeightMessageSchema,
  ArtifactListRequestSchema,
  ArtifactOpenLinkMessageSchema,
  ArtifactPageToHostMessageSchema,
  ArtifactPublishInputSchema,
  ArtifactPublishedNotificationSchema,
  ArtifactThemeMessageSchema,
} from './artifact.schemas';

const nonce = '0123456789abcdef';
const record = {
  id: 'abcdefghijklmnop',
  title: 'Dashboard',
  revision: 1,
  sessionId: 'session-1',
  viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
  createdAt: '2026-10-20T12:00:00.000Z',
};

describe('artifact wire schemas', () => {
  it('accepts either publish source and trims a bounded title', () => {
    expect(ArtifactPublishInputSchema.parse({ title: '  Page  ', html: '<h1>Hi</h1>' }))
      .toEqual({ title: 'Page', html: '<h1>Hi</h1>' });
    expect(ArtifactPublishInputSchema.safeParse({ title: 'Page', path: 'index.html' }).success)
      .toBe(true);
    expect(ArtifactPublishInputSchema.safeParse({ title: 'x'.repeat(121), html: 'a' }).success)
      .toBe(false);
    expect(ArtifactPublishInputSchema.safeParse({ title: '   ', html: 'a' }).success)
      .toBe(false);
  });

  it('rejects both sources, neither source, blank paths and unknown keys', () => {
    for (const input of [
      { title: 'Page', html: 'a', path: 'index.html' },
      { title: 'Page' },
      { title: 'Page', path: '  ' },
      { title: 'Page', html: 'a', sessionId: 'agent-supplied' },
    ]) expect(ArtifactPublishInputSchema.safeParse(input).success).toBe(false);
  });

  it('limits HTML by UTF-8 bytes', () => {
    expect(ArtifactPublishInputSchema.safeParse({
      title: 'Page', html: 'é'.repeat(ARTIFACT_MAX_BYTES / 2),
    }).success).toBe(true);
    expect(ArtifactPublishInputSchema.safeParse({
      title: 'Page', html: 'é'.repeat(ARTIFACT_MAX_BYTES / 2 + 1),
    }).success).toBe(false);
  });

  it('validates metadata and a bounded routing session list request', () => {
    expect(ArtifactPublishedNotificationSchema.safeParse(record).success).toBe(true);
    expect(ArtifactPublishedNotificationSchema.safeParse({ ...record, html: '<h1>secret</h1>' }).success)
      .toBe(false);
    expect(ArtifactListRequestSchema.parse({ sessionId: ' tab-a ' })).toEqual({ sessionId: 'tab-a' });
    expect(ArtifactListRequestSchema.safeParse({}).success).toBe(false);
    expect(ArtifactListRequestSchema.safeParse({ sessionId: ' '.repeat(2) }).success).toBe(false);
    expect(ArtifactListRequestSchema.safeParse({ sessionId: 'x'.repeat(201) }).success).toBe(false);
  });

  it('enforces nonce, theme allowlist and strict bridge objects', () => {
    expect(ArtifactThemeMessageSchema.safeParse({
      type: 'theme', mode: 'dark', vars: { '--ptah-gold': '#fff' }, nonce,
    }).success).toBe(true);
    expect(ArtifactThemeMessageSchema.safeParse({
      type: 'theme', mode: 'dark', vars: { '--evil': 'red' }, nonce,
    }).success).toBe(false);
    expect(ArtifactThemeMessageSchema.safeParse({
      type: 'theme', mode: 'dark', vars: {}, nonce: 'short',
    }).success).toBe(false);
    expect(ArtifactThemeMessageSchema.safeParse({
      type: 'theme', mode: 'dark', vars: {}, nonce, extra: true,
    }).success).toBe(false);
  });

  it('requires an integer height within 160..1600', () => {
    for (const px of [ARTIFACT_HEIGHT_MIN, ARTIFACT_HEIGHT_MAX]) {
      expect(ArtifactHeightMessageSchema.safeParse({ type: 'height', px, nonce }).success)
        .toBe(true);
    }
    for (const px of [159, 1601, 200.5, Infinity]) {
      expect(ArtifactHeightMessageSchema.safeParse({ type: 'height', px, nonce }).success)
        .toBe(false);
    }
  });

  it('allows only HTTP(S) links and rejects extra bridge fields', () => {
    for (const url of ['https://example.com', 'http://example.com/a']) {
      expect(ArtifactPageToHostMessageSchema.safeParse({ type: 'open-link', url, nonce }).success)
        .toBe(true);
    }
    for (const url of ['javascript:alert(1)', 'file:///tmp/a',
      'ptah-artifact://abcdefghijklmnop/index.html']) {
      expect(ArtifactOpenLinkMessageSchema.safeParse({ type: 'open-link', url, nonce }).success)
        .toBe(false);
    }
    expect(ArtifactOpenLinkMessageSchema.safeParse({
      type: 'open-link', url: 'https://example.com', nonce, extra: 1,
    }).success).toBe(false);
  });
});
