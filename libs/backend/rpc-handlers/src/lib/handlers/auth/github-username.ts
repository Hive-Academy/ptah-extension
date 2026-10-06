import type { IPlatformAuthProvider } from '@ptah-extension/platform-core';

/**
 * Retrieve the GitHub username from the platform auth provider.
 * Returns undefined if no active session is found.
 * Delegates to IPlatformAuthProvider instead of vscode.authentication.
 */
export async function getGitHubUsername(
  platformAuth: IPlatformAuthProvider,
): Promise<string | undefined> {
  return platformAuth.getGitHubUsername();
}
