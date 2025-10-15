import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { CommandTemplate } from '@ptah-extension/shared';

@injectable()
export class CommandBuilderService implements vscode.Disposable {
  private templates: CommandTemplate[] = [];
  private usageStats = new Map<string, number>();

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {
    this.loadDefaultTemplates();
    this.loadUsageStats();
  }

  async getTemplates(): Promise<CommandTemplate[]> {
    return this.templates;
  }

  async getTemplate(id: string): Promise<CommandTemplate | undefined> {
    return this.templates.find((t) => t.id === id);
  }

  async addCustomTemplate(template: CommandTemplate): Promise<void> {
    this.templates.push(template);
    await this.saveCustomTemplates();
  }

  async removeTemplate(id: string): Promise<void> {
    this.templates = this.templates.filter((t) => t.id !== id);
    await this.saveCustomTemplates();
  }

  async trackCommandUsage(templateId: string): Promise<void> {
    const currentUsage = this.usageStats.get(templateId) || 0;
    this.usageStats.set(templateId, currentUsage + 1);
    await this.saveUsageStats();
  }

  getUsageStats(): Map<string, number> {
    return new Map(this.usageStats);
  }

  private loadDefaultTemplates(): void {
    this.templates = [
      {
        id: 'code-review',
        name: 'Code Review',
        description:
          'Comprehensive code review with security and best practices analysis',
        category: 'analysis',
        template:
          'Please review this code for {{focus}}. Pay special attention to {{aspects}}:\\n\\n{{code}}',
        icon: 'search-review',
        tags: ['review', 'security', 'bugs', 'quality'],
        parameters: [
          {
            name: 'code',
            type: 'file',
            required: true,
            description: 'Code file to review',
            placeholder: 'Select file to review...',
          },
          {
            name: 'focus',
            type: 'select',
            required: true,
            description: 'Primary focus of the review',
            defaultValue: 'bugs and security issues',
            options: [
              'bugs and security issues',
              'performance optimization',
              'code style and best practices',
              'maintainability and readability',
              'architecture and design patterns',
            ],
          },
          {
            name: 'aspects',
            type: 'multiselect',
            required: false,
            description: 'Specific aspects to analyze',
            options: [
              'Error handling',
              'Input validation',
              'SQL injection prevention',
              'XSS prevention',
              'Memory leaks',
              'Performance bottlenecks',
              'Code duplication',
              'Naming conventions',
            ],
          },
        ],
        examples: [
          {
            title: 'Security Review',
            description: 'Focus on security vulnerabilities',
            parameters: {
              focus: 'bugs and security issues',
              aspects: [
                'Input validation',
                'SQL injection prevention',
                'XSS prevention',
              ],
            },
          },
        ],
      },
      {
        id: 'generate-tests',
        name: 'Generate Tests',
        description: 'Generate comprehensive test suites for code',
        category: 'testing',
        template:
          'Generate {{testType}} tests for this {{language}} code. Include tests for {{coverage}}:\\n\\n{{code}}',
        icon: 'beaker',
        tags: ['testing', 'unit tests', 'integration', 'e2e'],
        parameters: [
          {
            name: 'code',
            type: 'file',
            required: true,
            description: 'Code to generate tests for',
            placeholder: 'Select source file...',
          },
          {
            name: 'testType',
            type: 'select',
            required: true,
            description: 'Type of tests to generate',
            defaultValue: 'unit',
            options: ['unit', 'integration', 'e2e', 'performance'],
          },
          {
            name: 'language',
            type: 'string',
            required: false,
            description: 'Programming language (auto-detected if empty)',
            placeholder: 'e.g., TypeScript, Python, Java',
          },
          {
            name: 'coverage',
            type: 'multiselect',
            required: true,
            description: 'What to test',
            defaultValue: ['happy paths', 'error cases'],
            options: [
              'happy paths',
              'error cases',
              'edge cases',
              'boundary conditions',
              'performance characteristics',
              'concurrent access',
            ],
          },
        ],
      },
      {
        id: 'explain-code',
        name: 'Explain Code',
        description: 'Get detailed explanations of complex code',
        category: 'documentation',
        template:
          'Please explain this {{language}} code in {{style}} style. Focus on {{focus}}:\\n\\n{{code}}',
        icon: 'book',
        tags: ['documentation', 'explain', 'learning'],
        parameters: [
          {
            name: 'code',
            type: 'file',
            required: true,
            description: 'Code to explain',
            placeholder: 'Select code file...',
          },
          {
            name: 'language',
            type: 'string',
            required: false,
            description: 'Programming language',
            placeholder: 'Auto-detected',
          },
          {
            name: 'style',
            type: 'select',
            required: true,
            description: 'Explanation style',
            defaultValue: 'beginner-friendly',
            options: [
              'beginner-friendly',
              'technical detailed',
              'concise summary',
              'step-by-step walkthrough',
            ],
          },
          {
            name: 'focus',
            type: 'select',
            required: true,
            description: 'What to focus on',
            defaultValue: 'overall functionality',
            options: [
              'overall functionality',
              'algorithm explanation',
              'design patterns used',
              'performance characteristics',
              'potential improvements',
            ],
          },
        ],
      },
      {
        id: 'optimize-code',
        name: 'Optimize Code',
        description:
          'Optimize code for performance, readability, or maintainability',
        category: 'optimization',
        template:
          'Optimize this {{language}} code for {{goal}}. {{constraints}}\\n\\n{{code}}',
        icon: 'rocket',
        tags: ['optimization', 'performance', 'refactoring'],
        parameters: [
          {
            name: 'code',
            type: 'file',
            required: true,
            description: 'Code to optimize',
            placeholder: 'Select code file...',
          },
          {
            name: 'language',
            type: 'string',
            required: false,
            description: 'Programming language',
            placeholder: 'Auto-detected',
          },
          {
            name: 'goal',
            type: 'select',
            required: true,
            description: 'Optimization goal',
            defaultValue: 'performance',
            options: [
              'performance',
              'memory usage',
              'readability',
              'maintainability',
              'code size',
            ],
          },
          {
            name: 'constraints',
            type: 'string',
            required: false,
            description: 'Any constraints or requirements',
            placeholder: 'e.g., Must maintain backwards compatibility',
          },
        ],
      },
      {
        id: 'find-bugs',
        name: 'Find Bugs',
        description: 'Identify potential bugs and issues in code',
        category: 'analysis',
        template:
          'Analyze this {{language}} code for potential bugs and issues. Focus on {{severity}} issues:\\n\\n{{code}}',
        icon: 'bug',
        tags: ['bugs', 'debugging', 'analysis'],
        parameters: [
          {
            name: 'code',
            type: 'file',
            required: true,
            description: 'Code to analyze for bugs',
            placeholder: 'Select code file...',
          },
          {
            name: 'language',
            type: 'string',
            required: false,
            description: 'Programming language',
            placeholder: 'Auto-detected',
          },
          {
            name: 'severity',
            type: 'select',
            required: true,
            description: 'Focus on specific severity levels',
            defaultValue: 'all',
            options: [
              'all',
              'critical only',
              'high and critical',
              'runtime errors',
              'logic errors',
            ],
          },
        ],
      },
      {
        id: 'add-documentation',
        name: 'Add Documentation',
        description: 'Generate comprehensive documentation for code',
        category: 'documentation',
        template:
          'Generate {{docType}} documentation for this {{language}} code. Include {{sections}}:\\n\\n{{code}}',
        icon: 'book-open',
        tags: ['documentation', 'comments', 'readme'],
        parameters: [
          {
            name: 'code',
            type: 'file',
            required: true,
            description: 'Code to document',
            placeholder: 'Select code file...',
          },
          {
            name: 'language',
            type: 'string',
            required: false,
            description: 'Programming language',
            placeholder: 'Auto-detected',
          },
          {
            name: 'docType',
            type: 'select',
            required: true,
            description: 'Type of documentation',
            defaultValue: 'inline comments',
            options: [
              'inline comments',
              'README.md',
              'API documentation',
              'JSDoc/docstrings',
              'user guide',
            ],
          },
          {
            name: 'sections',
            type: 'multiselect',
            required: true,
            description: 'Documentation sections to include',
            defaultValue: ['overview', 'parameters', 'examples'],
            options: [
              'overview',
              'parameters',
              'return values',
              'examples',
              'error handling',
              'performance notes',
              'dependencies',
              'usage instructions',
            ],
          },
        ],
      },
    ];
  }

  private async saveCustomTemplates(): Promise<void> {
    try {
      const customTemplates = this.templates.filter((t) =>
        t.tags?.includes('custom')
      );
      await this.context.globalState.update(
        'ptah.customTemplates',
        customTemplates
      );
    } catch (error) {
      Logger.error('Failed to save custom templates:', error);
    }
  }

  private async loadUsageStats(): Promise<void> {
    try {
      const stats = this.context.globalState.get<Record<string, number>>(
        'ptah.usageStats',
        {}
      );
      this.usageStats = new Map(Object.entries(stats));
    } catch (error) {
      Logger.error('Failed to load usage stats:', error);
    }
  }

  private async saveUsageStats(): Promise<void> {
    try {
      const stats = Object.fromEntries(this.usageStats);
      await this.context.globalState.update('ptah.usageStats', stats);
    } catch (error) {
      Logger.error('Failed to save usage stats:', error);
    }
  }

  dispose(): void {
    // Cleanup if needed
  }
}
