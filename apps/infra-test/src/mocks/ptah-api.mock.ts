/**
 * Mock Ptah API for standalone testing
 *
 * Provides mock implementations of all 15 Ptah API namespaces.
 * Returns sample data for testing purposes.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PtahAPI } from '../types';

/**
 * Create a complete mock Ptah API instance
 */
export function createMockPtahAPI(): PtahAPI {
  const workspaceRoot = process.cwd();

  return {
    workspace: createWorkspaceNamespace(workspaceRoot),
    search: createSearchNamespace(workspaceRoot),
    symbols: createSymbolsNamespace(),
    diagnostics: createDiagnosticsNamespace(),
    git: createGitNamespace(),
    ai: createAINamespace(),
    files: createFilesNamespace(workspaceRoot),
    commands: createCommandsNamespace(),
    context: createContextNamespace(),
    project: createProjectNamespace(workspaceRoot),
    relevance: createRelevanceNamespace(),
    ast: createAstNamespace(),
    ide: createIDENamespace(),
    llm: createLLMNamespace(),
    orchestration: createOrchestrationNamespace(),
    help: createHelpMethod(),
  };
}

function createWorkspaceNamespace(workspaceRoot: string) {
  return {
    analyze: async () => ({
      info: {
        name: path.basename(workspaceRoot),
        projectType: 'Node.js',
        frameworks: ['TypeScript', 'Nx'],
        hasPackageJson: fs.existsSync(path.join(workspaceRoot, 'package.json')),
      },
      structure: {
        directories: ['apps', 'libs', 'docs'],
        fileCount: 500,
        totalSize: '10MB',
      },
    }),
    getInfo: async () => ({
      name: path.basename(workspaceRoot),
      projectType: 'Node.js',
      frameworks: ['TypeScript', 'Nx', 'Angular'],
      workspaceRoot,
    }),
    getProjectType: async () => 'Node.js',
    getFrameworks: async () => ['TypeScript', 'Nx', 'Angular', 'Jest'],
  };
}

function createSearchNamespace(workspaceRoot: string) {
  return {
    findFiles: async (pattern: string, limit = 10) => {
      // Simple mock implementation using glob-like pattern
      const results = [
        { path: 'apps/ptah-extension-vscode/src/main.ts', size: 1024 },
        { path: 'libs/backend/vscode-lm-tools/src/index.ts', size: 512 },
        { path: 'libs/shared/src/index.ts', size: 256 },
      ];
      return results.slice(0, limit);
    },
    getRelevantFiles: async (query: string, maxFiles = 10) => {
      return [
        {
          path: 'src/relevant-file.ts',
          relevance: 0.95,
          reason: `Matches: ${query}`,
        },
        {
          path: 'src/another-file.ts',
          relevance: 0.8,
          reason: 'Related content',
        },
      ].slice(0, maxFiles);
    },
  };
}

function createSymbolsNamespace() {
  return {
    find: async (name: string, type?: string) => [
      {
        name,
        kind: type || 'class',
        location: { file: 'src/example.ts', line: 10, column: 0 },
      },
    ],
  };
}

function createDiagnosticsNamespace() {
  return {
    getErrors: async () => [],
    getWarnings: async () => [],
    getAll: async () => [],
  };
}

function createGitNamespace() {
  return {
    getStatus: async () => ({
      branch: 'main',
      modified: ['src/modified-file.ts'],
      staged: [],
      untracked: ['new-file.ts'],
    }),
  };
}

function createAINamespace() {
  return {
    chat: async (message: string) =>
      `[Mock AI Response] Received: "${message.substring(0, 50)}..."`,
    selectModel: async () => [
      { id: 'gpt-4', family: 'gpt-4', name: 'GPT-4', vendor: 'openai' },
      {
        id: 'claude-3',
        family: 'claude',
        name: 'Claude 3',
        vendor: 'anthropic',
      },
    ],
  };
}

function createFilesNamespace(workspaceRoot: string) {
  return {
    read: async (filePath: string) => {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);
      try {
        return fs.readFileSync(fullPath, 'utf-8');
      } catch {
        throw new Error(`File not found: ${filePath}`);
      }
    },
    exists: async (filePath: string) => {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);
      return fs.existsSync(fullPath);
    },
    list: async (directory: string) => {
      const fullPath = path.isAbsolute(directory)
        ? directory
        : path.join(workspaceRoot, directory);
      try {
        return fs.readdirSync(fullPath);
      } catch {
        throw new Error(`Directory not found: ${directory}`);
      }
    },
  };
}

function createCommandsNamespace() {
  return {
    execute: async (command: string) => {
      return `[Mock] Command executed: ${command}`;
    },
    list: async () => [
      'workbench.action.files.save',
      'workbench.action.files.saveAll',
      'editor.action.formatDocument',
    ],
  };
}

function createContextNamespace() {
  return {
    getContext: async (query: string) => ({
      query,
      files: ['src/relevant.ts'],
      tokens: 1000,
    }),
    getTokenBudget: async () => 100000,
  };
}

function createProjectNamespace(workspaceRoot: string) {
  return {
    getProjectInfo: async () => {
      let packageJson = {};
      try {
        const content = fs.readFileSync(
          path.join(workspaceRoot, 'package.json'),
          'utf-8'
        );
        packageJson = JSON.parse(content);
      } catch {
        // No package.json
      }
      return {
        name:
          (packageJson as { name?: string }).name ||
          path.basename(workspaceRoot),
        version: (packageJson as { version?: string }).version || '0.0.0',
        type: 'monorepo',
        packageManager: 'npm',
      };
    },
    getDependencies: async () => {
      try {
        const content = fs.readFileSync(
          path.join(workspaceRoot, 'package.json'),
          'utf-8'
        );
        const pkg = JSON.parse(content);
        const deps = pkg.dependencies || {};
        return Object.entries(deps).map(([name, version]) => ({
          name,
          version,
          type: 'production',
        }));
      } catch {
        return [];
      }
    },
  };
}

function createRelevanceNamespace() {
  return {
    scoreRelevance: async (query: string, files: string[]) =>
      files.map((file, index) => ({
        file,
        score: Math.max(0, 1 - index * 0.1),
        reason: `Relevance to: ${query}`,
      })),
  };
}

function createAstNamespace() {
  return {
    parse: async (filePath: string) => ({
      type: 'Program',
      path: filePath,
      children: ['[Mock AST - full parsing not available in standalone mode]'],
    }),
    getSymbols: async (filePath: string) => [
      { name: 'ExampleClass', kind: 'class', line: 1 },
      { name: 'exampleFunction', kind: 'function', line: 10 },
    ],
  };
}

function createIDENamespace() {
  return {
    getActiveEditor: async () => null,
    getDiagnostics: async () => [],
  };
}

function createLLMNamespace() {
  return {
    chat: async (message: string) =>
      `[Mock LLM Response] ${message.substring(0, 50)}...`,
    countTokens: async (text: string) => Math.ceil(text.length / 4),
  };
}

function createOrchestrationNamespace() {
  let state: unknown = {};
  return {
    getState: async () => state,
    updateState: async (newState: unknown) => {
      state = { ...(state as object), ...(newState as object) };
    },
  };
}

function createHelpMethod() {
  return async (topic?: string) => {
    if (!topic) {
      return `
# Ptah API Help

Available namespaces (15 total):
- workspace: Workspace analysis and project detection
- search: File search and relevance scoring
- symbols: Code symbol search
- diagnostics: Errors and warnings
- git: Git repository status
- ai: AI/LLM chat integration
- files: File read/write operations
- commands: VS Code command execution
- context: Context management and token budget
- project: Project information and dependencies
- relevance: File relevance scoring
- ast: AST parsing and analysis
- ide: IDE features (editor, diagnostics)
- llm: LLM integration (Langchain)
- orchestration: Workflow state management

Use help('namespace') for detailed help on a specific namespace.

NOTE: This is a TEST server with mock implementations.
      `.trim();
    }

    const namespaceHelp: Record<string, string> = {
      workspace:
        'workspace.analyze(), workspace.getInfo(), workspace.getProjectType(), workspace.getFrameworks()',
      search:
        'search.findFiles(pattern, limit?), search.getRelevantFiles(query, maxFiles?)',
      symbols: 'symbols.find(name, type?)',
      diagnostics:
        'diagnostics.getErrors(), diagnostics.getWarnings(), diagnostics.getAll()',
      git: 'git.getStatus()',
      ai: 'ai.chat(message, model?), ai.selectModel(family?)',
      files: 'files.read(path), files.exists(path), files.list(directory)',
      commands: 'commands.execute(command, ...args), commands.list()',
      context: 'context.getContext(query), context.getTokenBudget()',
      project: 'project.getProjectInfo(), project.getDependencies()',
      relevance: 'relevance.scoreRelevance(query, files)',
      ast: 'ast.parse(filePath), ast.getSymbols(filePath)',
      ide: 'ide.getActiveEditor(), ide.getDiagnostics(path?)',
      llm: 'llm.chat(message), llm.countTokens(text)',
      orchestration:
        'orchestration.getState(), orchestration.updateState(state)',
    };

    return namespaceHelp[topic] || `Unknown namespace: ${topic}`;
  };
}
