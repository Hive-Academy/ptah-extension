/** The shell permits only artifact documents in child frames. */
export function isAllowedArtifactFrameUrl(target: string): boolean {
  try {
    const url = new URL(target);
    return url.protocol === 'ptah-artifact:' &&
      /^[A-Za-z0-9_-]{16,128}$/.test(url.hostname) &&
      url.pathname === '/index.html' && !url.search && !url.hash;
  } catch {
    return false;
  }
}
