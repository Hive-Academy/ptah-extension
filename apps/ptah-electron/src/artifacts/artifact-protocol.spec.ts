import {
  ARTIFACT_CSP,
  ARTIFACT_HEADERS,
  ARTIFACT_IFRAME_SANDBOX,
  createArtifactHandler,
  type ArtifactResolver,
} from './artifact-protocol';

describe('artifact protocol', () => {
  const resolve = jest.fn<ReturnType<ArtifactResolver['resolve']>, [string]>();
  const handler = createArtifactHandler({ resolve });

  beforeEach(() => resolve.mockReset());

  it('exports the exact containment policy and iframe sandbox', () => {
    expect(ARTIFACT_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
    );
    expect(ARTIFACT_IFRAME_SANDBOX).toBe('allow-scripts');
  });

  it('serves bytes with exact headers and resolves only the opaque host id', async () => {
    resolve.mockResolvedValue({ bytes: new TextEncoder().encode('<h1>ok</h1>') });
    const response = await handler(
      new Request('ptah-artifact://opaque-id/index.html'),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>ok</h1>');
    expect(Object.fromEntries(response.headers)).toEqual(
      Object.fromEntries(new Headers(ARTIFACT_HEADERS)),
    );
    expect(resolve).toHaveBeenCalledWith('opaque-id');
  });

  it.each([
    'ptah-artifact://opaque-id/other.html',
    'ptah-artifact://opaque-id/%2f/index.html',
    'ptah-artifact://opaque-id/index.html?x=1',
    'ptah-artifact://opaque-id/index.html#x',
    'ptah-artifact://../index.html',
    'ptah-artifact://%2e%2e/index.html',
    'ptah-artifact://opaque/id/index.html',
    'ptah-artifact://bad_id/index.html',
  ])('rejects invalid URL %s without resolving', async (url) => {
    const response = await handler(new Request(url));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns an undetailed 404 for unknown ids', async () => {
    resolve.mockResolvedValue(null);
    const response = await handler(
      new Request('ptah-artifact://unknown/index.html'),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });
});
