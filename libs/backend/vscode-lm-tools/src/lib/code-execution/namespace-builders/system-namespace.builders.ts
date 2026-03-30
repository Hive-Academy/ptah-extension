/**
 * System Namespace Builders
 *
 * Provides file system access and help documentation.
 * These namespaces enable system-level interactions.
 *
 * File operations (buildFilesNamespace, resolveWorkspacePath) use platform-core
 * IWorkspaceProvider and IFileSystemProvider for workspace-relative path resolution.
 */

import * as path from 'path';
import { FileSystemManager } from '@ptah-extension/vscode-core';
import { FileType } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { FilesNamespace } from '../types';

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
JSON: ptah.json.* (validate/repair JSON files)
GIT: ptah.git.* (worktree operations)
IDE: ptah.ide.* (lsp, editor, actions, testing) — VS Code exclusive
ORCHESTRATION: ptah.orchestration.* (workflow state management)
AGENT: ptah.agent.* (CLI agent orchestration - spawn, monitor, steer)

Use ptah.help('namespace') for details on any namespace.`,

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

  json: `ptah.json - JSON Validation & Repair

- validate({file, schema?}): Promise<JsonValidateResult> - Validate and repair a JSON file

Parameters:
  file: string — Workspace-relative path to the JSON file
  schema?: object — Optional JSON Schema for structural validation

Returns: { success, file, repairs[], errors[], fileOverwritten }

The validate method reads the file, extracts JSON from raw agent output (strips markdown
fences, removes prose, fixes trailing commas, single quotes, unquoted keys, comments,
unbalanced brackets), validates against an optional schema, and overwrites with clean JSON.

If validation fails, the errors array contains actionable messages for self-correction.
Call this after writing any JSON file to ensure clean, parseable output.`,

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

// buildAINamespace removed in TASK_2025_209 — ptah.ai namespace is obsolete,
// replaced by CLI tools + MCP agent spawn (ptah.agent.*).

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
  workspaceProvider: IWorkspaceProvider,
): string {
  // Normalize path separators to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Reject absolute paths (drive letters, UNC paths, Unix absolute)
  // Uses Node.js path.isAbsolute() which handles all platform cases
  if (path.isAbsolute(normalizedPath)) {
    throw new Error(
      'Absolute paths are not allowed. Use workspace-relative paths only.',
    );
  }

  // Reject path traversal attempts
  const resolved = path.normalize(normalizedPath);
  if (resolved.startsWith('..')) {
    throw new Error(
      'Path traversal is not allowed. Stay within workspace boundaries.',
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
  deps: SystemNamespaceDependencies,
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
