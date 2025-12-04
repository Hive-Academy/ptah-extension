/**
 * System Namespace Builders
 *
 * Provides AI/LM integration, file system access, and command execution.
 * These namespaces enable system-level interactions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
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
 * TASK_2025_039: Enhanced with advanced LLM chat, token intelligence, and specialized AI tasks
 */
export function buildAINamespace(): AINamespace {
  // Helper function to avoid 'this' context issues
  const namespace: AINamespace = {
    // ========================================
    // Basic Chat (Existing - Task 2.1 Enhanced)
    // ========================================

    /**
     * Send a chat message to VS Code language model
     * @param message - User message to send
     * @param model - Optional model family filter
     * @returns Complete model response text
     */
    chat: async (message: string, model?: string) => {
      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      const models = await vscode.lm.selectChatModels({ family: model });
      if (models.length === 0) {
        throw new Error(
          `No language model found${model ? ` for family: ${model}` : ''}`
        );
      }

      const selectedModel = models[0];
      const messages = [vscode.LanguageModelChatMessage.User(message)];

      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const response = await selectedModel.sendRequest(
          messages,
          {},
          tokenSource.token
        );

        let fullResponse = '';
        for await (const chunk of response.text) {
          fullResponse += chunk;
        }
        return fullResponse;
      } finally {
        tokenSource.dispose();
      }
    },

    /**
     * Select available language models with full metadata
     * @param family - Optional family filter
     * @returns Array of available model metadata including maxInputTokens, vendor, version
     */
    selectModel: async (family?: string) => {
      const models = await vscode.lm.selectChatModels(
        family ? { family } : undefined
      );
      return models.map((m) => ({
        id: m.id,
        family: m.family,
        name: m.name,
        maxInputTokens: m.maxInputTokens,
        vendor: m.vendor,
        version: m.version,
      }));
    },

    // ========================================
    // Chat Enhancements (TASK_2025_039)
    // ========================================

    /**
     * Multi-turn conversation with message history
     * @param messages - Array of chat messages with roles (user/assistant)
     * @param model - Optional model family filter
     * @returns Complete model response text
     */
    chatWithHistory: async (
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      model?: string
    ) => {
      if (!messages || messages.length === 0) {
        throw new Error('Messages array cannot be empty');
      }

      const models = await vscode.lm.selectChatModels({
        family: model || 'gpt-4o',
      });

      if (models.length === 0) {
        throw new Error(`No model found for family: ${model || 'gpt-4o'}`);
      }

      const selectedModel = models[0];

      // Convert ChatMessage[] to vscode.LanguageModelChatMessage[]
      const vscodeMessages = messages.map((msg) => {
        if (!msg.content || msg.content.trim().length === 0) {
          throw new Error('Message content cannot be empty');
        }
        return msg.role === 'user'
          ? vscode.LanguageModelChatMessage.User(msg.content)
          : vscode.LanguageModelChatMessage.Assistant(msg.content);
      });

      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const response = await selectedModel.sendRequest(
          vscodeMessages,
          {},
          tokenSource.token
        );

        let result = '';
        for await (const chunk of response.text) {
          result += chunk;
        }

        return result;
      } finally {
        tokenSource.dispose();
      }
    },

    /**
     * Streaming chat with chunk-by-chunk callback
     * @param message - User message to send
     * @param onChunk - Callback invoked for each response chunk
     * @param model - Optional model family filter
     * @returns Promise that resolves when streaming is complete
     */
    chatStream: async (
      message: string,
      onChunk: (chunk: string) => void,
      model?: string
    ) => {
      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      if (typeof onChunk !== 'function') {
        throw new Error('onChunk must be a function');
      }

      const models = await vscode.lm.selectChatModels({
        family: model || 'gpt-4o',
      });

      if (models.length === 0) {
        throw new Error(`No model found for family: ${model || 'gpt-4o'}`);
      }

      const selectedModel = models[0];
      const messages = [vscode.LanguageModelChatMessage.User(message)];

      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const response = await selectedModel.sendRequest(
          messages,
          {},
          tokenSource.token
        );

        for await (const chunk of response.text) {
          onChunk(chunk);
        }
      } finally {
        tokenSource.dispose();
      }
    },

    /**
     * Chat with custom system prompt for task-specific behavior
     * Uses XML-delimited format for clear instruction boundaries
     * @param message - User message to send
     * @param systemPrompt - System prompt defining behavior/role
     * @param model - Optional model family filter
     * @returns Complete model response text
     */
    chatWithSystem: async (
      message: string,
      systemPrompt: string,
      model?: string
    ) => {
      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      if (!systemPrompt || systemPrompt.trim().length === 0) {
        throw new Error('System prompt cannot be empty');
      }

      const models = await vscode.lm.selectChatModels({
        family: model || 'gpt-4o',
      });

      if (models.length === 0) {
        throw new Error(`No model found for family: ${model || 'gpt-4o'}`);
      }

      const selectedModel = models[0];

      // Use XML-delimited format for system prompt (claude-copilot pattern)
      const formattedMessage = `<SYSTEM_INSTRUCTIONS>
${systemPrompt}
</SYSTEM_INSTRUCTIONS>

<USER_MESSAGE>
${message}
</USER_MESSAGE>`;

      const messages = [vscode.LanguageModelChatMessage.User(formattedMessage)];

      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const response = await selectedModel.sendRequest(
          messages,
          {},
          tokenSource.token
        );

        let result = '';
        for await (const chunk of response.text) {
          result += chunk;
        }

        return result;
      } finally {
        tokenSource.dispose();
      }
    },

    /**
     * Invoke an agent with .md file as system prompt
     * Enables Claude CLI to delegate tasks to cheaper models (gpt-4o-mini, haiku)
     * @param agentPath - Path to agent .md file (e.g., ".claude/agents/senior-tester.md")
     * @param task - Task description for the agent
     * @param model - Optional model to use (default: cost-optimized model)
     * @returns Agent's response
     */
    invokeAgent: async (
      agentPath: string,
      task: string,
      model?: string
    ): Promise<string> => {
      if (!agentPath || agentPath.trim().length === 0) {
        throw new Error('Agent path cannot be empty');
      }

      if (!task || task.trim().length === 0) {
        throw new Error('Task cannot be empty');
      }

      // Validate path is safe (prevent path traversal)
      const normalizedPath = path.normalize(agentPath);
      if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
        throw new Error(
          'Agent path must be relative to workspace root and cannot contain ".."'
        );
      }

      // Read agent definition file
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder open');
      }

      const agentFilePath = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        normalizedPath
      );

      let agentDefinition: string;
      try {
        // Check file size BEFORE reading (prevent resource exhaustion)
        const stat = await vscode.workspace.fs.stat(agentFilePath);
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit
        if (stat.size > maxSizeBytes) {
          throw new Error(
            `Agent file exceeds maximum size of ${maxSizeBytes / 1024 / 1024}MB`
          );
        }

        // Now safe to read
        const fileContent = await vscode.workspace.fs.readFile(agentFilePath);
        agentDefinition = Buffer.from(fileContent).toString('utf8');
      } catch (error) {
        throw new Error(
          `Failed to read agent file ${agentPath}: ${(error as Error).message}`
        );
      }

      // Use chatWithSystem to invoke with agent definition as system prompt
      return namespace.chatWithSystem(
        task,
        agentDefinition,
        model || 'gpt-4o-mini'
      );
    },

    // ========================================
    // Token Intelligence (TASK_2025_039)
    // ========================================

    /**
     * Count tokens in text using model-specific tokenizer
     * @param text - Text to count tokens for
     * @param model - Optional model family filter (default: active model)
     * @returns Token count
     */
    countTokens: async (text: string, model?: string) => {
      if (!text || text.trim().length === 0) {
        throw new Error('Text cannot be empty');
      }

      const models = await vscode.lm.selectChatModels({
        family: model || 'gpt-4o',
      });

      if (models.length === 0) {
        throw new Error(`No model found for family: ${model || 'gpt-4o'}`);
      }

      const selectedModel = models[0];
      const tokenSource = new vscode.CancellationTokenSource();
      try {
        return await selectedModel.countTokens(text, tokenSource.token);
      } finally {
        tokenSource.dispose();
      }
    },

    /**
     * Count tokens in a file using model-specific tokenizer
     * @param filePath - Absolute or relative file path
     * @param model - Optional model family filter (default: active model)
     * @returns Token count
     */
    countFileTokens: async (filePath: string, model?: string) => {
      if (!filePath || filePath.trim().length === 0) {
        throw new Error('File path cannot be empty');
      }

      // Read file
      const uri = vscode.Uri.file(filePath);
      let fileContent: string;

      try {
        // Check file size BEFORE reading (prevent resource exhaustion)
        const stat = await vscode.workspace.fs.stat(uri);
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit
        if (stat.size > maxSizeBytes) {
          throw new Error(
            `File exceeds maximum size of ${maxSizeBytes / 1024 / 1024}MB`
          );
        }

        // Now safe to read
        const fileData = await vscode.workspace.fs.readFile(uri);
        fileContent = Buffer.from(fileData).toString('utf8');
      } catch (error) {
        throw new Error(
          `Failed to read file ${filePath}: ${(error as Error).message}`
        );
      }

      // Count tokens
      return namespace.countTokens(fileContent, model);
    },

    /**
     * Check if content fits in model's context window
     * @param content - Content to check
     * @param model - Optional model family filter (default: active model)
     * @param reserve - Reserved tokens for response (default: 4000)
     * @returns True if content fits in context window
     */
    fitsInContext: async (
      content: string,
      model?: string,
      reserve?: number
    ) => {
      if (!content || content.trim().length === 0) {
        throw new Error('Content cannot be empty');
      }

      const models = await vscode.lm.selectChatModels({
        family: model || 'gpt-4o',
      });

      if (models.length === 0) {
        throw new Error(`No model found for family: ${model || 'gpt-4o'}`);
      }

      const selectedModel = models[0];
      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const tokenCount = await selectedModel.countTokens(
          content,
          tokenSource.token
        );

        const reserveTokens = reserve ?? 4000; // Default reserve (match types.ts)
        const availableTokens = selectedModel.maxInputTokens - reserveTokens;

        return tokenCount <= availableTokens;
      } finally {
        tokenSource.dispose();
      }
    },

    // ========================================
    // Tool Integration (TASK_2025_039)
    // ========================================

    /**
     * List all registered VS Code LM tools
     * @returns Array of tool information (name, description, schema)
     */
    getTools: async () => {
      const tools = vscode.lm.tools;

      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },

    /**
     * Invoke a VS Code LM tool directly
     * @param name - Tool name
     * @param input - Tool input parameters (must match tool's schema)
     * @returns Tool execution result
     */
    invokeTool: async (name: string, input: any) => {
      if (!name || name.trim().length === 0) {
        throw new Error('Tool name cannot be empty');
      }

      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const result = await vscode.lm.invokeTool(
          name,
          {
            input,
            toolInvocationToken: undefined, // Invoked outside of chat request
          },
          tokenSource.token
        );

        return result;
      } finally {
        tokenSource.dispose();
      }
    },

    /**
     * Chat with access to specific VS Code tools
     * @param message - User message to send
     * @param toolNames - Array of tool names to make available
     * @param model - Optional model family filter
     * @returns Complete model response text
     */
    chatWithTools: async (
      message: string,
      toolNames: string[],
      model?: string
    ) => {
      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      if (!toolNames || toolNames.length === 0) {
        throw new Error('Tool names array cannot be empty');
      }

      const models = await vscode.lm.selectChatModels({
        family: model || 'gpt-4o',
      });

      if (models.length === 0) {
        throw new Error(`No model found for family: ${model || 'gpt-4o'}`);
      }

      const selectedModel = models[0];
      const messages = [vscode.LanguageModelChatMessage.User(message)];

      // Get tools by name
      const availableTools = vscode.lm.tools.filter((tool) =>
        toolNames.includes(tool.name)
      );

      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const response = await selectedModel.sendRequest(
          messages,
          { tools: availableTools },
          tokenSource.token
        );

        let result = '';
        for await (const chunk of response.text) {
          result += chunk;
        }

        return result;
      } finally {
        tokenSource.dispose();
      }
    },

    // ========================================
    // Specialized AI Tasks (TASK_2025_039 - Phase 3)
    // ========================================

    /**
     * Summarize content using VS Code LM
     * @param content - Content to summarize
     * @param options - Task options (model, maxLength, format)
     * @returns Summary text
     */
    summarize: async (
      content: string,
      options?: { model?: string; maxLength?: number; format?: string }
    ) => {
      const systemPrompt = `You are a summarization assistant. Summarize the following content concisely${
        options?.maxLength
          ? ` in no more than ${options.maxLength} characters`
          : ''
      }${
        options?.format ? ` and format the output as ${options.format}` : ''
      }.`;

      return namespace.chatWithSystem(content, systemPrompt, options?.model);
    },

    /**
     * Explain code with context awareness
     * @param code - Code to explain
     * @param options - Task options (model, maxLength, format)
     * @returns Explanation text
     */
    explain: async (
      code: string,
      options?: { model?: string; maxLength?: number; format?: string }
    ) => {
      const systemPrompt = `You are a code explanation assistant. Explain the following code in a clear, educational manner. Focus on what the code does, how it works, and any notable patterns or techniques used${
        options?.format === 'markdown' ? ' using markdown formatting' : ''
      }.`;

      return namespace.chatWithSystem(code, systemPrompt, options?.model);
    },

    /**
     * Code review via VS Code LM
     * @param code - Code to review
     * @param options - Task options (model, maxLength, format)
     * @returns Review feedback text
     */
    review: async (
      code: string,
      options?: { model?: string; maxLength?: number; format?: string }
    ) => {
      const systemPrompt = `You are a code review assistant. Review the following code for:
- Code quality and best practices
- Potential bugs or issues
- Performance considerations
- Security concerns
- Readability and maintainability

Provide constructive feedback${
        options?.format === 'markdown'
          ? ' using markdown formatting with sections'
          : ''
      }.`;

      return namespace.chatWithSystem(code, systemPrompt, options?.model);
    },

    /**
     * Transform code by instruction
     * @param code - Code to transform
     * @param instruction - Transformation instruction
     * @param model - Optional model family filter
     * @returns Transformed code
     */
    transform: async (code: string, instruction: string, model?: string) => {
      const systemPrompt = `You are a code transformation assistant. Transform the code according to the user's instruction. Return ONLY the transformed code without explanations or markdown formatting.`;

      const message = `Instruction: ${instruction}

Code:
${code}`;

      return namespace.chatWithSystem(message, systemPrompt, model);
    },

    /**
     * Generate code from description
     * @param description - Description of code to generate
     * @param options - Task options (model, maxLength, format)
     * @returns Generated code
     */
    generate: async (
      description: string,
      options?: { model?: string; maxLength?: number; format?: string }
    ) => {
      const systemPrompt = `You are a code generation assistant. Generate clean, well-structured code based on the user's description. Include comments explaining key parts. Follow best practices and modern conventions${
        options?.format === 'typescript'
          ? ' and write TypeScript code'
          : options?.format === 'javascript'
          ? ' and write JavaScript code'
          : ''
      }.`;

      return namespace.chatWithSystem(
        description,
        systemPrompt,
        options?.model
      );
    },
  };

  return namespace;
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
