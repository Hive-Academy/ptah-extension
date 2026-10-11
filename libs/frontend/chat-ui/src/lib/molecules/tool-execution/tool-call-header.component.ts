import {
  Component,
  ElementRef,
  input,
  inject,
  output,
  computed,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-angular';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import { ToolIconComponent } from '../../atoms/tool-icon.component';
import { DurationBadgeComponent } from '../../atoms/duration-badge.component';
import { CopyTextButtonComponent } from '../../atoms/copy-text-button.component';
import type { ExecutionNode } from '@ptah-extension/shared';
import {
  isReadToolInput,
  isWriteToolInput,
  isEditToolInput,
  isBashToolInput,
  isGrepToolInput,
  isGlobToolInput,
  isWebFetchToolInput,
  isWebSearchToolInput,
  isAgentDispatchTool,
} from '@ptah-extension/shared';
import {
  describeToolTarget,
  displayToolName,
  isPtahMcpToolName,
  shortenToolPath,
  toolStatusBadgeClass,
  truncateToolText,
} from '../../utils/tool-target.utils';
import {
  getLanguageFromPath,
  getLanguageLabel,
} from '../../utils/tool-language.utils';

/**
 * Outcome of a command (Bash) call as text plus an icon name. There is no
 * exit code on `ExecutionNode` (A9), so the name is "Command succeeded" or
 * "Command failed" without "exit code N".
 */
interface CommandOutcome {
  readonly text: 'succeeded' | 'failed' | 'running';
  readonly label: string;
}

/**
 * ToolCallHeaderComponent - Header section for tool call display
 *
 * Complexity Level: 2 (Molecule - composition of atoms)
 * Patterns: Composition pattern, event delegation
 *
 * Features:
 * - Toggle `<button>` (`aria-expanded`) holding the chevron, tool icon,
 *   badges, target, parse warning, status and duration
 * - File tools (Read, Write, Edit): file name prominent, directory muted,
 *   full path in `title`, a language label, and a separate 28 px
 *   "Open <file>" button beside the toggle (buttons do not nest) that opens
 *   through `FILE_LINK_OPENER`
 * - Command tools (Bash): an outcome pill ("succeeded", "failed",
 *   "running") whose icon has an accessible name, and a command row (`$`,
 *   mono, full text in `title`; one line while collapsed, wrapping when
 *   expanded) with "Copy command"
 * - Status icons carry accessible names; the streaming description shows
 *   while the call runs
 * - Text wraps or ends in an ellipsis; nothing scrolls sideways
 */
@Component({
  selector: 'ptah-tool-call-header',
  standalone: true,
  imports: [
    LucideAngularModule,
    ToolIconComponent,
    DurationBadgeComponent,
    CopyTextButtonComponent,
  ],
  template: `
    <div class="flex items-start min-w-0">
      <button
        #toggle
        type="button"
        class="flex-1 min-w-0 py-1.5 px-2 text-[11px] flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left hover:bg-base-300/30 transition-colors cursor-pointer"
        (click)="toggleClicked.emit()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="isCollapsed() ? null : 'tool-' + node().id"
      >
        <!-- Chevron icon -->
        <lucide-angular
          [img]="ChevronIcon"
          class="w-3 h-3 flex-shrink-0 text-base-content-muted transition-transform"
          [class.rotate-0]="!isCollapsed()"
          [class.-rotate-90]="isCollapsed()"
          aria-hidden="true"
        />

        <!-- Tool icon -->
        <ptah-tool-icon [toolName]="node().toolName || 'Unknown'" />

        <!-- Tool name badge -->
        @if (isPtahMcpTool()) {
          <span class="badge badge-xs font-mono px-1.5 ptah-superpower-badge">
            Ptah Superpower
          </span>
          <span class="badge badge-xs font-mono px-1.5 ptah-tool-name-badge">
            {{ getPtahToolName() }}
          </span>
        } @else {
          <span [class]="'badge badge-xs font-mono px-1.5 ' + getBadgeClass()">
            {{ node().toolName }}
          </span>
        }

        <!-- Target (file or generic) - HIDDEN during streaming to avoid redundancy -->
        <!-- File path: one line while collapsed, wraps when expanded -->
        @if (node().status !== 'streaming' && filePath()) {
          <span
            class="flex-1 min-w-0 font-mono text-[10px]"
            [class.truncate]="isCollapsed()"
            [class.break-all]="!isCollapsed()"
            [title]="filePath()"
            data-testid="tool-file-path"
          >
            <span class="font-semibold text-base-content">{{
              fileName()
            }}</span>
            @if (fileDirectory()) {
              <span class="ml-1 text-base-content-muted">{{
                fileDirectory()
              }}</span>
            }
          </span>
          <span
            class="badge badge-ghost badge-xs text-[10px] text-base-content-muted flex-shrink-0"
            data-testid="tool-language"
            >{{ fileLanguageLabel() }}</span
          >
        } @else if (node().status !== 'streaming') {
          <span
            class="text-base-content-muted truncate flex-1 min-w-0 font-mono text-[10px]"
            [title]="getFullDescription()"
          >
            {{ getToolDescription() }}
          </span>
        }

        <!-- Parse Error Warning -->
        @if (hasParseError()) {
          <div
            class="flex items-center gap-1 flex-shrink-0 px-1.5 py-0.5 bg-warning/20 rounded text-warning"
            [title]="'Parse Error: ' + parseError()"
          >
            <lucide-angular
              [img]="AlertIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            <span class="text-[10px] font-mono">Parse Error</span>
          </div>
        }

        <!-- Status: command outcome pill, or a named status icon -->
        @if (commandOutcome(); as outcome) {
          <span
            class="badge badge-xs gap-1 px-1.5 text-[10px] flex-shrink-0 bg-base-300/50 border-0"
            [class.text-success]="outcome.text === 'succeeded'"
            [class.text-error]="outcome.text === 'failed'"
            [class.text-info]="outcome.text === 'running'"
            data-testid="command-outcome"
          >
            <lucide-angular
              [img]="outcomeIcon(outcome)"
              class="w-3 h-3"
              [class.animate-spin]="outcome.text === 'running'"
              role="img"
              [attr.aria-label]="outcome.label"
            />
            <span aria-hidden="true">{{ outcome.text }}</span>
          </span>
        } @else if (node().status === 'complete' && node().toolOutput) {
          <lucide-angular
            [img]="CheckIcon"
            class="w-3 h-3 text-success flex-shrink-0"
            role="img"
            aria-label="Completed"
          />
        } @else if (node().status === 'error') {
          <lucide-angular
            [img]="XIcon"
            class="w-3 h-3 text-error flex-shrink-0"
            role="img"
            aria-label="Failed"
          />
        }

        @if (node().status === 'streaming') {
          <div class="flex items-center gap-1 flex-1 min-w-0">
            @if (!isCommandTool()) {
              <lucide-angular
                [img]="LoaderIcon"
                class="w-3 h-3 text-info animate-spin flex-shrink-0"
                role="img"
                aria-label="Running"
              />
            }
            <span
              class="text-base-content-muted text-[10px] animate-pulse font-mono truncate"
            >
              {{ getStreamingDescription() }}
            </span>
          </div>
        }

        <!-- Duration -->
        @if (node().duration) {
          <ptah-duration-badge [durationMs]="node().duration!" />
        }
      </button>

      <!-- Open file: a sibling of the toggle, never nested inside it -->
      @if (filePath()) {
        <button
          type="button"
          class="btn btn-ghost btn-square btn-xs h-7 w-7 min-h-0 flex-shrink-0 text-info/80 hover:text-info"
          [attr.aria-label]="'Open ' + fileName()"
          [title]="'Open ' + filePath()"
          (click)="openFile()"
        >
          <lucide-angular
            [img]="ExternalLinkIcon"
            class="w-3 h-3"
            aria-hidden="true"
          />
        </button>
      }
    </div>

    <!-- Command row: one line while collapsed, wraps when expanded -->
    @if (bashCommand()) {
      <div
        class="flex items-start gap-1 px-2 pb-1 font-mono text-[10px]"
        data-testid="tool-command-row"
      >
        <span
          class="py-1.5 text-base-content-muted select-none"
          aria-hidden="true"
          >$</span
        >
        <code
          class="flex-1 min-w-0 py-1.5 text-base-content"
          [class.truncate]="isCollapsed()"
          [class.whitespace-pre-wrap]="!isCollapsed()"
          [class.break-all]="!isCollapsed()"
          [title]="bashCommand()"
          >{{ bashCommand() }}</code
        >
        <ptah-copy-text-button [text]="bashCommand()" label="Copy command" />
      </div>
    }
  `,
  // `.ptah-superpower-badge` / `.ptah-tool-name-badge` are defined once
  // globally in apps/ptah-extension-webview/src/styles.css, keyed off the
  // theme-aware `--ptah-gold*` tokens. Do not re-add a local copy.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallHeaderComponent {
  private readonly opener = inject(FILE_LINK_OPENER);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = input.required<boolean>();
  readonly toggleClicked = output<void>();
  readonly ChevronIcon = ChevronDown;
  readonly CheckIcon = CheckCircle;
  readonly XIcon = XCircle;
  readonly LoaderIcon = Loader2;
  readonly AlertIcon = AlertTriangle;
  readonly ExternalLinkIcon = ExternalLink;

  private readonly toggle =
    viewChild.required<ElementRef<HTMLButtonElement>>('toggle');

  /**
   * Check if tool input has parse error
   */
  readonly hasParseError = computed(() => {
    const input = this.node().toolInput;
    return (
      input &&
      typeof input === 'object' &&
      '__parseError' in input &&
      typeof input['__parseError'] === 'string'
    );
  });

  /**
   * Get parse error message
   */
  readonly parseError = computed(() => {
    const input = this.node().toolInput;
    if (
      input &&
      typeof input === 'object' &&
      '__parseError' in input &&
      typeof input['__parseError'] === 'string'
    ) {
      return input['__parseError'];
    }
    return '';
  });

  /** The file this call targets; empty when it is not a file tool. */
  protected readonly filePath = computed(() =>
    this.hasClickableFilePath() ? this.getFilePath() : '',
  );

  /** Last path segment, shown prominently. */
  protected readonly fileName = computed(() => {
    const path = this.filePath().replace(/\\/g, '/');
    return path.slice(path.lastIndexOf('/') + 1);
  });

  /** Directory part of the path (no trailing slash), shown muted. */
  protected readonly fileDirectory = computed(() => {
    const path = this.filePath().replace(/\\/g, '/');
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
  });

  protected readonly fileLanguageLabel = computed(() =>
    getLanguageLabel(getLanguageFromPath(this.filePath())),
  );

  /** A shell command call: the Bash tool, or any input carrying `command`. */
  protected readonly isCommandTool = computed(
    () =>
      this.node().toolName === 'Bash' || isBashToolInput(this.node().toolInput),
  );

  /** The full command text; empty when the input has none (yet). */
  protected readonly bashCommand = computed(() => {
    const input = this.node().toolInput;
    return isBashToolInput(input) ? input.command : '';
  });

  protected readonly commandOutcome = computed<CommandOutcome | null>(() => {
    if (!this.isCommandTool()) return null;
    switch (this.node().status) {
      case 'complete':
        return { text: 'succeeded', label: 'Command succeeded' };
      case 'error':
        return { text: 'failed', label: 'Command failed' };
      case 'streaming':
        return { text: 'running', label: 'Command running' };
      default:
        return null;
    }
  });

  protected outcomeIcon(outcome: CommandOutcome): typeof CheckCircle {
    if (outcome.text === 'succeeded') return this.CheckIcon;
    if (outcome.text === 'failed') return this.XIcon;
    return this.LoaderIcon;
  }

  /** Move focus to the expand toggle (used when the item collapses on Escape). */
  focusToggle(): void {
    this.toggle().nativeElement.focus();
  }

  /**
   * Check if tool has clickable file path
   */
  protected hasClickableFilePath(): boolean {
    const toolInput = this.node().toolInput;
    if (
      isReadToolInput(toolInput) ||
      isWriteToolInput(toolInput) ||
      isEditToolInput(toolInput)
    ) {
      return true;
    }
    return this.hasFilePathField();
  }

  /**
   * Get file path from tool input
   */
  protected getFilePath(): string {
    const toolInput = this.node().toolInput;
    if (isReadToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (isWriteToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (isEditToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (
      toolInput &&
      typeof toolInput === 'object' &&
      'file_path' in toolInput &&
      typeof toolInput['file_path'] === 'string'
    ) {
      return toolInput['file_path'];
    }
    return '';
  }

  /**
   * Check if tool input has a file_path field and tool name suggests a file operation.
   */
  private hasFilePathField(): boolean {
    const toolInput = this.node().toolInput;
    const toolName = (this.node().toolName || '').toLowerCase();
    if (
      toolInput &&
      typeof toolInput === 'object' &&
      'file_path' in toolInput &&
      typeof toolInput['file_path'] === 'string' &&
      /read|write|edit|replace|create_file|patch_file/.test(toolName)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Get tool description for display
   */
  protected getToolDescription(): string {
    return this.toolTarget().short;
  }

  /**
   * Get full description for title attribute
   */
  protected getFullDescription(): string {
    return this.toolTarget().full;
  }

  private readonly toolTarget = computed(() =>
    describeToolTarget(this.node().toolName || '', this.node().toolInput),
  );

  /**
   * Get streaming description
   */
  protected getStreamingDescription(): string {
    const toolName = this.node().toolName;
    const input = this.node().toolInput;

    if (!toolName || !input) return 'Working...';

    if (isReadToolInput(input)) {
      return `Reading ${shortenToolPath(input.file_path)}...`;
    }
    if (isWriteToolInput(input)) {
      return `Writing ${shortenToolPath(input.file_path)}...`;
    }
    if (isEditToolInput(input)) {
      return `Editing ${shortenToolPath(input.file_path)}...`;
    }
    if (isBashToolInput(input)) {
      const desc = input.description;
      if (desc) return `${desc}...`;
      const cmd = input.command;
      return `Running ${truncateToolText(cmd, 20)}...`;
    }
    if (isGrepToolInput(input)) {
      return `Searching for "${truncateToolText(input.pattern, 15)}"...`;
    }
    if (isGlobToolInput(input)) {
      return `Finding ${truncateToolText(input.pattern, 15)}...`;
    }
    if (isWebFetchToolInput(input)) {
      return `Fetching ${truncateToolText(input.url, 20)}...`;
    }
    if (isWebSearchToolInput(input)) {
      return `Searching "${truncateToolText(input.query, 15)}"...`;
    }
    if (isAgentDispatchTool(toolName)) {
      return 'Invoking agent...';
    }
    return `Executing ${toolName}...`;
  }

  /**
   * Check if this is any MCP tool call
   */
  isMcpTool(): boolean {
    const toolName = this.node().toolName || '';
    return toolName.startsWith('mcp__');
  }

  /**
   * Check if this is a Ptah MCP server tool call
   * Matches both ptah-cli format (mcp__ptah__*) and Copilot format (ptah-ptah_*)
   */
  isPtahMcpTool(): boolean {
    return isPtahMcpToolName(this.node().toolName || '');
  }

  /**
   * Clean Ptah MCP tool name (`mcp__ptah__workspace_analyze` ->
   * "workspace analyze", `ptah-ptah_search_files` -> "search files").
   */
  protected getPtahToolName(): string {
    return displayToolName(this.node().toolName || '');
  }

  /**
   * Get badge class based on status
   */
  protected getBadgeClass(): string {
    return toolStatusBadgeClass(this.node().status);
  }

  /**
   * Open the target file through the host's opener (desktop viewer or the
   * VS Code editor). A rejection is logged, as in `ptah-file-path-link`; the
   * host renders the failure.
   */
  protected openFile(): void {
    const path = this.filePath();
    if (!path) return;
    void this.opener
      .open({ path, origin: this.host.nativeElement })
      .catch((error: unknown) => {
        console.error('[ToolCallHeader] Failed to open', path, error);
      });
  }
}
