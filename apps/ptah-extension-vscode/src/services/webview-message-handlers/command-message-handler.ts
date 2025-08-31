import * as vscode from 'vscode';
import * as path from 'path';
import {
  BaseWebviewMessageHandler,
  StrictPostMessageFunction,
  IWebviewMessageHandler,
} from './base-message-handler';
import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  CommandsGetTemplatesPayload,
  CommandsExecuteCommandPayload,
  CommandsSelectFilePayload,
  CommandsSaveTemplatePayload,
} from '@ptah-extension/shared';
import { CorrelationId } from '@ptah-extension/shared';
import { CommandBuilderService } from '../command-builder.service';

/**
 * Command Message Types - Strict type definition
 */
type CommandMessageTypes =
  | 'commands:getTemplates'
  | 'commands:executeCommand'
  | 'commands:selectFile'
  | 'commands:saveTemplate';

/**
 * CommandMessageHandler - Single Responsibility: Handle command builder related messages
 */
export class CommandMessageHandler
  extends BaseWebviewMessageHandler<CommandMessageTypes>
  implements IWebviewMessageHandler<CommandMessageTypes>
{
  readonly messageType = 'commands:';

  constructor(
    postMessage: StrictPostMessageFunction,
    private commandBuilderService: CommandBuilderService
  ) {
    super(postMessage);
  }

  async handle<K extends CommandMessageTypes>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse> {
    try {
      switch (messageType) {
        case 'commands:getTemplates':
          return await this.handleGetTemplates();
        case 'commands:executeCommand':
          return await this.handleExecuteCommand(payload as CommandsExecuteCommandPayload);
        case 'commands:selectFile':
          return await this.handleSelectFile(payload as CommandsSelectFilePayload);
        case 'commands:saveTemplate':
          return await this.handleSaveTemplate(payload as CommandsSaveTemplatePayload);
        default:
          throw new Error(`Unknown command message type: ${messageType}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Command handler error';
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'COMMAND_HANDLER_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleGetTemplates(): Promise<MessageResponse> {
    try {
      const templates = await this.commandBuilderService.getTemplates();
      const data = { templates };
      this.sendSuccessResponse('commands:templates', data);
      return {
        requestId: CorrelationId.create(),
        success: true,
        data,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get templates';
      this.sendErrorResponse('commands:getTemplates', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'GET_TEMPLATES_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleExecuteCommand(
    data: CommandsExecuteCommandPayload
  ): Promise<MessageResponse> {
    try {
      // Track usage for analytics
      await this.commandBuilderService.trackCommandUsage(data.templateId);

      const template = await this.commandBuilderService.getTemplate(data.templateId);
      if (!template) {
        throw new Error(`Template ${data.templateId} not found`);
      }

      // Build the command string by replacing template variables
      let command = template.template;
      for (const [key, value] of Object.entries(data.parameters)) {
        command = command.replace(`{{${key}}}`, String(value));
      }

      const result = {
        success: true,
        command,
        template,
        parameters: data.parameters,
        timestamp: new Date(),
      };

      this.sendSuccessResponse('commands:executeResult', { result });
      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { result },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Execution failed';
      this.sendErrorResponse('commands:executeCommand', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'COMMAND_EXECUTION_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleSelectFile(data: CommandsSelectFilePayload): Promise<MessageResponse> {
    try {
      const options: vscode.OpenDialogOptions = {
        canSelectMany: data.multiple || false,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: 'Select File(s)',
      };

      const result = await vscode.window.showOpenDialog(options);
      if (result) {
        const files = result.map((uri) => ({
          path: uri.fsPath,
          name: path.basename(uri.fsPath),
        }));

        this.sendSuccessResponse('commands:fileSelected', { files });
        return {
          requestId: CorrelationId.create(),
          success: true,
          data: { files },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      } else {
        return {
          requestId: CorrelationId.create(),
          success: true,
          data: { files: [] },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to select file';
      this.sendErrorResponse('commands:selectFile', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'FILE_SELECT_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleSaveTemplate(data: CommandsSaveTemplatePayload): Promise<MessageResponse> {
    try {
      await this.commandBuilderService.addCustomTemplate(data.template);
      const responseData = { success: true };
      this.sendSuccessResponse('commands:templateSaved', responseData);
      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save template';
      this.sendErrorResponse('commands:saveTemplate', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'TEMPLATE_SAVE_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }
}
