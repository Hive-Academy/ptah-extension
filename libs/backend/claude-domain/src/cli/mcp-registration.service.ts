import { injectable, inject } from 'tsyringe';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';

const execAsync = promisify(exec);

@injectable()
export class MCPRegistrationService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Register Ptah MCP server with Claude CLI (one-time)
   * Uses environment variable placeholder for dynamic port
   */
  async registerPtahMCPServer(): Promise<void> {
    try {
      // Check if already registered
      const isRegistered = await this.isPtahMCPRegistered();

      if (isRegistered) {
        this.logger.info(
          'Ptah MCP server already registered',
          'MCPRegistrationService'
        );
        return;
      }

      // Register with environment variable placeholder
      // --scope local: project-specific, private to user (highest priority)
      // ${PTAH_MCP_PORT}: expands at runtime to actual port
      const command =
        'claude mcp add --scope local --transport http ptah "http://localhost:${PTAH_MCP_PORT}"';

      this.logger.info(
        'Registering Ptah MCP server',
        'MCPRegistrationService',
        {
          command,
        }
      );

      const { stdout, stderr } = await execAsync(command);

      if (stderr && !stderr.includes('success')) {
        throw new Error(`MCP registration failed: ${stderr}`);
      }

      this.logger.info('MCP server registered successfully', {
        context: 'MCPRegistrationService',
        stdout,
        config: {
          scope: 'local',
          transport: 'http',
          name: 'ptah',
          url: 'http://localhost:${PTAH_MCP_PORT}',
        },
      });
    } catch (error) {
      this.logger.error('Failed to register Ptah MCP server', {
        context: 'MCPRegistrationService',
        error,
      });
      throw error;
    }
  }

  /**
   * Check if Ptah MCP server is already registered
   */
  private async isPtahMCPRegistered(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('claude mcp list');
      return stdout.includes('ptah');
    } catch (error) {
      // If 'claude mcp list' fails, assume not registered
      this.logger.error('Failed to check MCP registration', {
        context: 'MCPRegistrationService',
        error,
      });
      return false;
    }
  }

  /**
   * Unregister Ptah MCP server (cleanup)
   */
  async unregisterPtahMCPServer(): Promise<void> {
    try {
      const isRegistered = await this.isPtahMCPRegistered();

      if (!isRegistered) {
        this.logger.info(
          'Ptah MCP server not registered, skipping unregister',
          'MCPRegistrationService'
        );
        return;
      }

      const { stdout } = await execAsync('claude mcp remove ptah');

      this.logger.info('MCP server unregistered successfully', {
        context: 'MCPRegistrationService',
        stdout,
      });
    } catch (error) {
      this.logger.error('Failed to unregister Ptah MCP server', {
        context: 'MCPRegistrationService',
        error,
      });
      // Don't throw - cleanup should be non-blocking
    }
  }
}
