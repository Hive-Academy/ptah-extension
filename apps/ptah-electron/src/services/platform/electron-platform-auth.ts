/**
 * Electron Platform Auth Provider Implementation
 *
 * Stub implementation for Electron:
 * - getGitHubUsername: Returns undefined (Copilot auth not available outside VS Code)
 */

import { injectable } from 'tsyringe';
import type { IPlatformAuthProvider } from '@ptah-extension/rpc-handlers';

@injectable()
export class ElectronPlatformAuth implements IPlatformAuthProvider {
  async getGitHubUsername(): Promise<string | undefined> {
    // GitHub Copilot authentication is not available in Electron
    return undefined;
  }
}
