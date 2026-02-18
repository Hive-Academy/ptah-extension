import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Server,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Search,
  Bug,
  GitBranch,
  BrainCircuit,
  FileCode2,
  Terminal,
  Eye,
} from 'lucide-angular';
import { DocsCodeBlockComponent } from '../components/docs-code-block.component';
import { DocsMediaPlaceholderComponent } from '../components/docs-media-placeholder.component';
import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

@Component({
  selector: 'ptah-docs-mcp-server',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsCodeBlockComponent,
    DocsMediaPlaceholderComponent,
    DocsSectionShellComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="mcp-server">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-3"
      >
        Ptah MCP Server
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/50 mb-4 max-w-2xl"
      >
        Ptah includes a built-in
        <strong class="text-white/70"
          >MCP (Model Context Protocol) server</strong
        >
        that runs inside the VS Code extension host. It gives Claude Code's
        subagents direct access to VS Code's internal capabilities — LSP,
        diagnostics, workspace analysis, git, and more.
      </p>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/40 text-sm mb-8 max-w-2xl"
      >
        Instead of Claude manually exploring files and running bash commands, it
        queries Ptah's APIs to get structured, accurate results in a single
        call. This is a <strong class="text-white/60">Pro feature</strong> —
        automatically enabled when you have an active license.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        <!-- How it works -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="ServerIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">How It Works</h3>
          </div>
          <p class="text-sm text-white/50 mb-4">
            When the extension starts, the MCP server launches on a local port
            and registers itself in your workspace's
            <code
              class="px-1 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-xs font-mono text-amber-400/80"
              >.mcp.json</code
            >. Every Claude Code subagent spawned via the
            <code
              class="px-1 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-xs font-mono text-amber-400/80"
              >Task</code
            >
            tool automatically discovers it and gains access to all Ptah tools.
          </p>
          <p class="text-sm text-white/50">
            Claude receives a system prompt that instructs it to prefer Ptah
            tools over built-in alternatives — so it uses
            <code class="text-amber-400/70 text-xs">ptah_get_diagnostics</code>
            instead of running a build to check errors, or
            <code class="text-amber-400/70 text-xs">ptah_lsp_references</code>
            instead of grepping for symbol usages.
          </p>
        </div>

        <!-- MCP Tools Grid -->
        <div>
          <h3 class="text-base font-semibold text-white/80 mb-4">
            Available MCP Tools
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            @for (tool of mcpTools; track tool.name) {
            <div
              class="flex items-start gap-3 px-4 py-3 rounded-xl bg-slate-800/30 border border-amber-500/10"
            >
              <lucide-angular
                [img]="tool.icon"
                class="w-4 h-4 text-amber-400/70 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <code class="text-sm font-mono text-white/80">{{
                  tool.name
                }}</code>
                <p class="text-xs text-white/40 mt-0.5">
                  {{ tool.description }}
                </p>
              </div>
            </div>
            }
          </div>
        </div>

        <!-- API Namespaces -->
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="BrainCircuitIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-lg font-semibold text-white/90">
              15 API Namespaces
            </h3>
          </div>
          <p class="text-sm text-white/50 mb-4">
            The
            <code class="text-amber-400/70 text-xs">execute_code</code> tool
            gives Claude access to the full
            <code class="text-amber-400/70 text-xs">ptah.*</code> API. Claude
            can write TypeScript that queries your workspace, analyzes code
            structure, accesses LSP features, and even calls other AI models.
          </p>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            @for (ns of apiNamespaces; track ns.name) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/20 border border-slate-600/20"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-amber-400/50 shrink-0"
                aria-hidden="true"
              />
              <div>
                <code class="text-xs font-mono text-amber-400/70">{{
                  ns.name
                }}</code>
                <span class="text-xs text-white/30 ml-1.5">{{ ns.hint }}</span>
              </div>
            </div>
            }
          </div>
        </div>

        <!-- Example -->
        <div>
          <h3 class="text-base font-semibold text-white/80 mb-3">
            What Claude Can Do
          </h3>
          <ptah-docs-code-block
            [code]="exampleCode"
            label="Claude uses ptah.* APIs autonomously"
          />
        </div>

        <!-- Security -->
        <div
          class="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/15"
        >
          <lucide-angular
            [img]="ShieldCheckIcon"
            class="w-5 h-5 text-green-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div class="text-sm text-white/60">
            <strong class="text-white/80">Security model:</strong> Read-only
            operations (workspace info, diagnostics, file search) run without
            prompts. Modifications (file writes, git operations) trigger a
            permission dialog in VS Code. All code execution has configurable
            timeouts and results are truncated at 50KB to prevent context
            overflow.
          </div>
        </div>
      </div>

      <ng-container media>
        <ptah-docs-media-placeholder
          title="MCP Server in Action"
          aspectRatio="16/9"
          mediaType="gif"
        />
      </ng-container>
    </ptah-docs-section-shell>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpServerSectionComponent {
  public readonly ServerIcon = Server;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly ShieldCheckIcon = ShieldCheck;
  public readonly SparklesIcon = Sparkles;
  public readonly SearchIcon = Search;
  public readonly BugIcon = Bug;
  public readonly GitBranchIcon = GitBranch;
  public readonly BrainCircuitIcon = BrainCircuit;
  public readonly FileCode2Icon = FileCode2;
  public readonly TerminalIcon = Terminal;
  public readonly EyeIcon = Eye;

  public readonly mcpTools = [
    {
      name: 'ptah_workspace_analyze',
      description: 'Full project analysis: type, frameworks, architecture',
      icon: Search,
    },
    {
      name: 'ptah_search_files',
      description: 'Glob search respecting .gitignore',
      icon: Search,
    },
    {
      name: 'ptah_get_diagnostics',
      description:
        'Live TypeScript errors and warnings from the language server',
      icon: Bug,
    },
    {
      name: 'ptah_lsp_references',
      description: 'Find all references to a symbol via LSP',
      icon: Eye,
    },
    {
      name: 'ptah_lsp_definitions',
      description: 'Go-to-definition through re-exports and node_modules',
      icon: FileCode2,
    },
    {
      name: 'ptah_get_dirty_files',
      description: 'Unsaved files in VS Code editor buffers',
      icon: GitBranch,
    },
    {
      name: 'ptah_count_tokens',
      description: 'Token count for a file using model tokenizer',
      icon: Terminal,
    },
    {
      name: 'execute_code',
      description: 'Run TypeScript with access to all 15 ptah.* APIs',
      icon: BrainCircuit,
    },
  ];

  public readonly apiNamespaces = [
    { name: 'ptah.workspace', hint: 'project info' },
    { name: 'ptah.search', hint: 'file search' },
    { name: 'ptah.symbols', hint: 'code symbols' },
    { name: 'ptah.diagnostics', hint: 'errors' },
    { name: 'ptah.git', hint: 'git status' },
    { name: 'ptah.ai', hint: 'multi-LLM' },
    { name: 'ptah.files', hint: 'file I/O' },
    { name: 'ptah.commands', hint: 'VS Code cmds' },
    { name: 'ptah.context', hint: 'token budget' },
    { name: 'ptah.project', hint: 'deep analysis' },
    { name: 'ptah.relevance', hint: 'file scoring' },
    { name: 'ptah.ast', hint: 'tree-sitter' },
    { name: 'ptah.ide.lsp', hint: 'LSP features' },
    { name: 'ptah.ide.editor', hint: 'editor state' },
    { name: 'ptah.ide.actions', hint: 'refactoring' },
  ];

  public readonly exampleCode = `// Claude autonomously queries your workspace:
const project = await ptah.workspace.analyze();
// → { type: "angular-nx", frameworks: ["Angular 20", "NestJS"] }

const errors = await ptah.diagnostics.getErrors();
// → [{ file: "app.ts", line: 42, message: "TS2345: ..." }]

const refs = await ptah.ide.lsp.getReferences("src/auth.ts", 15, 8);
// → Find every file that uses this function

const analysis = await ptah.ast.queryClasses("src/user.service.ts");
// → Class names, methods, properties via tree-sitter`;

  public readonly headingConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.2,
  };

  public readonly introConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly contentConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.15,
    threshold: 0.1,
  };
}
