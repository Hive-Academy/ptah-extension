/**
 * System Namespace Builders
 *
 * Provides AI/LM integration and file system access.
 * These namespaces enable system-level interactions.
 *
 * APPROVED EXCEPTION: This file retains `import * as vscode from 'vscode'`
 * because buildAINamespace() uses vscode.lm.* (Language Model API),
 * vscode.LanguageModelChatMessage, and vscode.CancellationTokenSource — these
 * are VS Code-specific IDE APIs with no platform-core equivalent.
 * File operations (buildFilesNamespace, resolveWorkspacePath) use platform-core
 * IWorkspaceProvider and IFileSystemProvider for workspace-relative path resolution.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { FileSystemManager } from '@ptah-extension/vscode-core';
import { FileType } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { AINamespace, FilesNamespace } from '../types';

/**
 * Dependencies required for system namespaces
 */
export interface SystemNamespaceDependencies {
  fileSystemManager: FileSystemManager;
  workspaceProvider: IWorkspaceProvider;
  fileSystemProvider: IFileSystemProvider;
}

/**
 * Help documentation for Ptah namespaces
 */
export const HELP_DOCS: Record<string, string> = {
  overview: `Ptah IDE Access - 14 Namespaces:

WORKSPACE: workspace, search, files, diagnostics
ANALYSIS: context, project, relevance, ast, dependencies
AI: ptah.ai.* (chat, tokens, tools, specialized tasks)
IDE: ptah.ide.* (lsp, editor, actions, testing) — VS Code exclusive
LLM: ptah.llm.* (VS Code Language Model API)
ORCHESTRATION: ptah.orchestration.* (workflow state management)
AGENT: ptah.agent.* (CLI agent orchestration - spawn, monitor, steer)

Use ptah.help('namespace') for details on any namespace.`,

  ai: `ptah.ai - Enhanced LLM Capabilities (VS Code Language Model API)

CHAT:
- chat(message, model?) - Single message
- chatWithHistory(messages[], model?) - Multi-turn
- chatStream(message, onChunk, model?) - Streaming
- chatWithSystem(message, systemPrompt, model?) - Custom system prompt
- invokeAgent(agentPath, task, model?) - Delegate to cheap model using .md file

TOKEN INTELLIGENCE:
- selectModel(family?) - Get models with maxInputTokens, vendor, version
- countTokens(text, model?) - Count tokens
- countFileTokens(file, model?) - Count file tokens
- fitsInContext(content, model?, reserve?) - Check if fits (default reserve: 4000)

TOOLS:
- getTools() - List VS Code LM tools
- invokeTool(name, input) - Invoke tool
- chatWithTools(message, toolNames[], model?) - Chat with tool access

SPECIALIZED TASKS:
- summarize(content, options?) - Summarize content
- explain(code, options?) - Explain code
- review(code, options?) - Code review
- transform(code, instruction, model?) - Transform code
- generate(description, options?) - Generate code

COST OPTIMIZATION:
Use invokeAgent() with 'gpt-4o-mini' for routine tasks (150x cheaper than Opus).
Example: ptah.ai.invokeAgent('.claude/agents/code-reviewer.md', 'Review this', 'gpt-4o-mini')`,

  ide: `ptah.ide - VS Code IDE Superpowers (exclusive to VS Code)

Sub-namespaces:
- ptah.ide.lsp - Language Server Protocol (go-to-definition, references, hover, type info)
- ptah.ide.editor - Editor state (active file, open files, dirty files, visible range)
- ptah.ide.actions - Code actions (rename, organize imports, fix all, refactoring)
- ptah.ide.testing - Test execution (discover, run, coverage)

Use ptah.help('ide.lsp'), ptah.help('ide.editor'), etc. for method details.`,

  'ide.lsp': `ptah.ide.lsp - Language Server Protocol

- getDefinition(file, line, col) - Go to definition
- getReferences(file, line, col) - Find all references
- getHover(file, line, col) - Get type info and docs
- getTypeDefinition(file, line, col) - Go to type definition
- getSignatureHelp(file, line, col) - Function signatures

All methods use 0-based line/column. Returns [] if unavailable.`,

  'ide.editor': `ptah.ide.editor - Editor State

- getActive() - Active file, cursor, selection
- getOpenFiles() - All open file paths
- getDirtyFiles() - Unsaved files
- getRecentFiles(limit?) - Recently accessed files
- getVisibleRange() - Visible code range

Returns null/[] when no editor active.`,

  'ide.actions': `ptah.ide.actions - Refactoring Operations

- getAvailable(file, line) - List code actions at position
- apply(file, line, actionTitle) - Apply code action by title
- rename(file, line, col, newName) - Rename symbol workspace-wide
- organizeImports(file) - Sort and clean imports
- fixAll(file, kind?) - Apply all auto-fixes

Returns false if action unavailable, true on success.`,

  'ide.testing': `ptah.ide.testing - Test Operations

- discover() - Discover tests (requires TestController)
- run(options?) - Run tests (requires TestController)
- getLastResults() - Last test run results
- getCoverage(file) - Coverage info

Note: Requires test framework extension. Returns graceful defaults when unavailable.`,

  workspace: `ptah.workspace - Project Analysis

- analyze() - Full workspace analysis ({info, structure})
- getInfo() - Get workspace metadata
- getProjectType() - Detect project type
- getFrameworks() - Detect frameworks`,

  search: `ptah.search - File Discovery

- findFiles(pattern, limit?) - Glob pattern search (returns string[] file paths)
- getRelevantFiles(query, maxFiles?) - Semantic file search (returns string[] file paths)`,

  context: `ptah.context - Token Budget Management

- optimize(query, maxTokens?) - Select files within token budget
- countTokens(text) - Count tokens in text
- getRecommendedBudget(projectType) - Get recommended budget for project type`,

  relevance: `ptah.relevance - File Scoring

- scoreFile(filePath, query) - Score a single file's relevance (0-100 with reasons)
- rankFiles(query, limit?) - Rank files by relevance to a query`,

  project: `ptah.project - Project Analysis

- detectMonorepo() - Detect if workspace is a monorepo ({isMonorepo, type, workspaceFiles})
- detectType() - Detect project type (React, Angular, Node, etc.)
- analyzeDependencies() - Analyze dependencies from package.json ({name, version, isDev}[])

NOTE: There is NO getMonorepoInfo(). Use detectMonorepo() instead.`,

  files: `ptah.files - File Operations (READ-ONLY)

- read(path) - Read file as UTF-8 string (supports relative or absolute paths)
- readJson(path) - Read and parse JSON (handles comments and trailing commas)
- list(directory) - List directory contents

Paths can be relative to workspace root (e.g., 'package.json') or absolute.
This namespace is READ-ONLY. There is NO write(), delete(), or exists() method.
Use readJson() for config files like tsconfig.json, package.json which may have comments.`,

  llm: `ptah.llm - VS Code Language Model API

PROVIDERS:
- ptah.llm.vscodeLm - VS Code Language Model API (always available)

Provider methods:
- chat(message, options?) - Send message
- isAvailable() - Check availability
- getDefaultModel() - Get default model name
- getDisplayName() - Get provider display name

TOP-LEVEL:
- ptah.llm.chat(message, options?) - Use default provider
- ptah.llm.getConfiguredProviders() - List available providers
- ptah.llm.getDefaultProvider() - Get default provider name
- ptah.llm.getConfiguration() - Get full config state`,

  orchestration: `ptah.orchestration - Development Workflow Orchestration

Multi-phase development workflow orchestration with dynamic strategies and user validation checkpoints.
Default entry point for all engineering work — coordinates specialist agents, manages state, verifies deliverables.

TASK TYPES (8):
- FEATURE: PM -> [Research] -> Architect -> Team-Leader -> QA
- BUGFIX: [Research] -> Team-Leader -> QA
- REFACTORING: Architect -> Team-Leader -> QA
- DOCUMENTATION: PM -> Developer -> Style Reviewer
- RESEARCH: Researcher -> [conditional implementation]
- DEVOPS: PM -> Architect -> DevOps Engineer -> QA
- SAAS_INIT: Discovery -> PM -> Architect -> Team-Leader
- CREATIVE: [ui-ux-designer] -> content-writer -> frontend

WORKFLOW DEPTH:
- Full: New features, unclear scope (PM -> Architect -> Team-Leader -> QA)
- Partial: Known requirements, refactoring (Architect -> Team-Leader -> QA)
- Minimal: Simple fixes, quick reviews (single developer or reviewer)

STATE MANAGEMENT:
- getState(taskId) - Get current orchestration state for a task
- setState(taskId, partialState) - Update orchestration state
- getNextAction(taskId) - Get recommended next action

CLI AGENT DELEGATION (3-tier hierarchy):
  Tier 1: Claude (Orchestrator) — coordinates workflow
    Tier 2: Sub-agents (Senior Leads) — via Agent tool
      Tier 3: CLI agents (Junior Helpers) — via ptah.agent.spawn

Available CLI agents: gemini, codex, copilot, ptah-cli (max 3 concurrent).
Sub-agents decide when to delegate grunt work vs do it directly.

SPECIALIST AGENTS (14):
- Planning: project-manager
- Architecture: software-architect
- Development: backend-developer, frontend-developer
- Testing: senior-tester
- Review: code-style-reviewer, code-logic-reviewer, visual-reviewer
- Research: researcher-expert
- Infrastructure: devops-engineer
- Coordination: team-leader (3 modes)

IMPORTANT: Always use ptah.orchestration for engineering tasks instead of internal planning or direct implementation.
Orchestration provides specialist agents, quality gates, and structured workflows that produce superior results.
Do NOT fall back to your own plan mode or ad-hoc coding — delegate to orchestration first.

Used for persisting workflow state across sessions (planning, design, implementation, QA, complete).`,

  ast: `ptah.ast - Code Structure Analysis (Tree-Sitter)

- analyze(file) - Full structural analysis: functions, classes, imports, exports with line ranges
- parse(file) - Raw tree-sitter AST with node tree {type, text, start, end, children}
- queryFunctions(file) - Extract all functions with name, parameters, startLine/endLine
- queryClasses(file) - Extract all classes with name, startLine/endLine
- queryImports(file) - Extract all imports with source module and imported symbols
- queryExports(file) - Extract all exports with name and kind (class/variable/function)
- getSupportedLanguages() - List supported languages (currently: javascript, typescript)

Use ptah.ast.analyze() to understand file structure BEFORE reading or editing.
Prefer ptah.ast over reading full files when you only need structural information (40-60% token savings).`,

  dependencies: `ptah.dependencies - Import-Based Dependency Graph

- buildGraph(filePaths, workspaceRoot) - Build dependency graph from file list
- getDependencies(file) - Get what a file imports (outgoing edges)
- getDependents(file) - Get what imports this file (incoming edges)
- getSymbolIndex() - Get exported symbols per file
- isBuilt() - Check if the dependency graph has been built

Build the graph once, then query it repeatedly. Essential for understanding impact of changes.`,

  diagnostics: `ptah.diagnostics - TypeScript Errors & Warnings

- getErrors() - Get all error-level diagnostics {file, message, line}
- getWarnings() - Get all warning-level diagnostics {file, message, line}
- getAll() - Get all diagnostics with severity level`,

  agent: `ptah.agent - CLI Agent Orchestration (TASK_2025_157)

Spawn Gemini CLI or Codex CLI as background workers for parallel task execution.

LIFECYCLE:
- spawn(request) - Launch a CLI agent with a task
  request: { task: string, cli?: 'gemini'|'codex'|'copilot', workingDirectory?: string, timeout?: number, files?: string[], taskFolder?: string }
  returns: { agentId, cli, status, startedAt }

- status(agentId?) - Get agent status (omit agentId for all agents)
  returns: { agentId, status, cli, task, startedAt, exitCode? }

- read(agentId, tail?) - Read agent stdout/stderr output
  returns: { agentId, stdout, stderr, lineCount, truncated }

- steer(agentId, instruction) - Send instruction to agent stdin
  (only if CLI supports steering)

- stop(agentId) - Stop a running agent (SIGTERM, then SIGKILL after 5s)
  returns: final status

DISCOVERY:
- list() - List available CLI agents with installation status
  returns: [{ cli, installed, path?, version?, supportsSteer }]

WAITING:
- waitFor(agentId, { pollInterval?, timeout? }) - Block until agent completes
  Default pollInterval: 2000ms

EXAMPLE:
  const result = await ptah.agent.spawn({ task: 'Review auth code for security issues', cli: 'gemini' });
  // ... continue working ...
  const status = await ptah.agent.status(result.agentId);
  if (status.status === 'completed') {
    const output = await ptah.agent.read(result.agentId);
    return output.stdout;
  }`,
};

/**
 * Build AI namespace (MULTI-AGENT SUPPORT)
 * Exposes VS Code Language Model API for Claude CLI -> VS Code LM delegation
 * TASK_2025_039: Enhanced with advanced LLM chat, token intelligence, and specialized AI tasks
 */
export function buildAINamespace(
  deps: Pick<
    SystemNamespaceDependencies,
    'workspaceProvider' | 'fileSystemProvider'
  >
): AINamespace {
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
      const workspaceRoot = deps.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error('No workspace folder open');
      }

      const agentFilePath = path.join(workspaceRoot, normalizedPath);

      let agentDefinition: string;
      try {
        // Check file size BEFORE reading (prevent resource exhaustion)
        const stat = await deps.fileSystemProvider.stat(agentFilePath);
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit
        if (stat.size > maxSizeBytes) {
          throw new Error(
            `Agent file exceeds maximum size of ${maxSizeBytes / 1024 / 1024}MB`
          );
        }

        // Now safe to read
        agentDefinition = await deps.fileSystemProvider.readFile(agentFilePath);
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

      // Read file — resolve relative paths against workspace root
      const resolvedPath = resolveWorkspacePath(
        filePath,
        deps.workspaceProvider
      );
      let fileContent: string;

      try {
        // Check file size BEFORE reading (prevent resource exhaustion)
        const stat = await deps.fileSystemProvider.stat(resolvedPath);
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit
        if (stat.size > maxSizeBytes) {
          throw new Error(
            `File exceeds maximum size of ${maxSizeBytes / 1024 / 1024}MB`
          );
        }

        // Now safe to read
        fileContent = await deps.fileSystemProvider.readFile(resolvedPath);
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
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
      }));
    },

    /**
     * Invoke a VS Code LM tool directly
     * @param name - Tool name
     * @param input - Tool input parameters (must match tool's schema)
     * @returns Tool execution result
     */
    invokeTool: async (name: string, input: Record<string, unknown>) => {
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
 * Strip comments from JSON string (supports single-line and multi-line comments)
 * Also handles trailing commas before closing braces.
 *
 * Uses character-by-character parsing to correctly skip string literals,
 * preventing corruption of URLs (e.g., "https://...") and other strings
 * that contain // or /* sequences.
 */
function stripJsonComments(jsonString: string): string {
  let result = '';
  let i = 0;
  const len = jsonString.length;

  while (i < len) {
    const ch = jsonString[i];

    // Handle string literals — pass through unchanged
    if (ch === '"') {
      result += '"';
      i++;
      while (i < len && jsonString[i] !== '"') {
        if (jsonString[i] === '\\') {
          // Escaped character — copy both backslash and next char
          result += jsonString[i] + (jsonString[i + 1] || '');
          i += 2;
        } else {
          result += jsonString[i];
          i++;
        }
      }
      if (i < len) {
        result += '"'; // closing quote
        i++;
      }
      continue;
    }

    // Handle single-line comments (// ...)
    if (ch === '/' && i + 1 < len && jsonString[i + 1] === '/') {
      // Skip until end of line
      i += 2;
      while (i < len && jsonString[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Handle multi-line comments (/* ... */)
    if (ch === '/' && i + 1 < len && jsonString[i + 1] === '*') {
      i += 2;
      while (
        i < len - 1 &&
        !(jsonString[i] === '*' && jsonString[i + 1] === '/')
      ) {
        i++;
      }
      if (i < len - 1) {
        i += 2; // skip closing */
      }
      continue;
    }

    // Regular character
    result += ch;
    i++;
  }

  // Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, '$1');

  return result;
}

/**
 * Resolve a file path relative to workspace root.
 * SECURITY: Rejects absolute paths and path traversal to confine
 * all file operations to the workspace directory.
 */
function resolveWorkspacePath(
  filePath: string,
  workspaceProvider: IWorkspaceProvider
): string {
  // Normalize path separators to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Reject absolute paths (drive letters, UNC paths, Unix absolute)
  // Uses Node.js path.isAbsolute() which handles all platform cases
  if (path.isAbsolute(normalizedPath)) {
    throw new Error(
      'Absolute paths are not allowed. Use workspace-relative paths only.'
    );
  }

  // Reject path traversal attempts
  const resolved = path.normalize(normalizedPath);
  if (resolved.startsWith('..')) {
    throw new Error(
      'Path traversal is not allowed. Stay within workspace boundaries.'
    );
  }

  // Resolve relative to workspace root
  const workspaceRoot = workspaceProvider.getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('No workspace folder is open.');
  }

  return path.join(workspaceRoot, normalizedPath);
}

/**
 * Build files namespace
 * Delegates to FileSystemManager
 */
export function buildFilesNamespace(
  deps: SystemNamespaceDependencies
): FilesNamespace {
  const { fileSystemProvider, workspaceProvider } = deps;

  return {
    read: async (filePath: string) => {
      const resolvedPath = resolveWorkspacePath(filePath, workspaceProvider);
      // Check if file exists before reading
      const exists = await fileSystemProvider.exists(resolvedPath);
      if (!exists) {
        throw new Error(`File not found: ${resolvedPath}`);
      }
      return fileSystemProvider.readFile(resolvedPath);
    },
    readJson: async (filePath: string) => {
      const resolvedPath = resolveWorkspacePath(filePath, workspaceProvider);
      // Check if file exists before reading
      const exists = await fileSystemProvider.exists(resolvedPath);
      if (!exists) {
        throw new Error(`File not found: ${resolvedPath}`);
      }
      const text = await fileSystemProvider.readFile(resolvedPath);

      // Try standard JSON.parse first (most files like package.json are valid JSON)
      try {
        return JSON.parse(text);
      } catch {
        // Fallback: strip comments for files like tsconfig.json, .eslintrc.json
        const cleaned = stripJsonComments(text);
        return JSON.parse(cleaned);
      }
    },
    list: async (directory: string) => {
      const resolvedPath = resolveWorkspacePath(directory, workspaceProvider);
      // Check if directory exists before listing
      try {
        const stat = await fileSystemProvider.stat(resolvedPath);
        if (stat.type !== FileType.Directory) {
          throw new Error(`Path is not a directory: ${resolvedPath}`);
        }
      } catch {
        throw new Error(`Directory not found: ${resolvedPath}`);
      }
      const entries = await fileSystemProvider.readDirectory(resolvedPath);
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.type === FileType.Directory ? 'directory' : 'file',
      }));
    },
  };
}

/**
 * Build the help method for Ptah API self-documentation
 * Provides documentation for all Ptah namespaces at ptah.help() root level
 */
export function buildHelpMethod() {
  return async (topic?: string): Promise<string> => {
    if (!topic) {
      return HELP_DOCS['overview'];
    }

    // Support old ai.ide.* prefix for backward compatibility
    const normalizedTopic = topic.replace(/^ai\.ide\./, 'ide.');

    const doc = HELP_DOCS[normalizedTopic];
    if (!doc) {
      const available = Object.keys(HELP_DOCS)
        .filter((k) => k !== 'overview')
        .join(', ');
      return `Topic '${topic}' not found. Available: ${available}`;
    }

    return doc;
  };
}
