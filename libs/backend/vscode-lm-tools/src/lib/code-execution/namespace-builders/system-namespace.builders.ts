/**
 * System Namespace Builders
 *
 * Provides AI/LM integration, file system access, and command execution.
 * These namespaces enable system-level interactions.
 */

import * as vscode from 'vscode';
import { FileSystemManager, CommandManager } from '@ptah-extension/vscode-core';
import { AINamespace, FilesNamespace, CommandsNamespace } from '../types';

/**
 * Dependencies required for system namespaces
 */
export interface SystemNamespaceDependencies {
  fileSystemManager: FileSystemManager;
  commandManager: CommandManager;
}

/**
 * Build AI namespace (MULTI-AGENT SUPPORT)
 * Exposes VS Code Language Model API for Claude CLI -> VS Code LM delegation
 */
export function buildAINamespace(): AINamespace {
  return {
    chat: async (message: string, model?: string) => {
      const models = await vscode.lm.selectChatModels({ family: model });
      if (models.length === 0) {
        throw new Error(
          `No language model found${model ? ` for family: ${model}` : ''}`
        );
      }

      const selectedModel = models[0];
      const messages = [vscode.LanguageModelChatMessage.User(message)];
      const response = await selectedModel.sendRequest(messages);

      let fullResponse = '';
      for await (const chunk of response.text) {
        fullResponse += chunk;
      }
      return fullResponse;
    },
    selectModel: async (family?: string) => {
      const models = await vscode.lm.selectChatModels(
        family ? { family } : undefined
      );
      return models.map((m) => ({
        id: m.id,
        family: m.family,
        name: m.name,
      }));
    },
  };
}

/**
 * Build files namespace
 * Delegates to FileSystemManager
 */
export function buildFilesNamespace(
  deps: SystemNamespaceDependencies
): FilesNamespace {
  const { fileSystemManager } = deps;

  return {
    read: async (path: string) => {
      const uri = vscode.Uri.file(path);
      const content = await fileSystemManager.readFile(uri);
      return new TextDecoder('utf-8').decode(content);
    },
    list: async (directory: string) => {
      const uri = vscode.Uri.file(directory);
      const entries = await fileSystemManager.readDirectory(uri);
      return entries.map(([name, type]) => ({
        name,
        type: type === vscode.FileType.Directory ? 'directory' : 'file',
      }));
    },
  };
}

/**
 * Build commands namespace
 * Uses VS Code's commands API
 */
export function buildCommandsNamespace(): CommandsNamespace {
  return {
    execute: async (commandId: string, ...args: any[]) => {
      return await vscode.commands.executeCommand(commandId, ...args);
    },
    list: async () => {
      const commands = await vscode.commands.getCommands();
      return commands.filter((c) => c.startsWith('ptah.'));
    },
  };
}
