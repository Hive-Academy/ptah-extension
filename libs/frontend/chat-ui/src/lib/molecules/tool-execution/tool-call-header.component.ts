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
  AlertTriangle,
  ExternalLink,
} from 'lucide-angular';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import { DurationBadgeComponent } from '../../atoms/duration-badge.component';
import type { ExecutionNode } from '@ptah-extension/shared';
import {
  isReadToolInput,
  isWriteToolInput,
  isEditToolInput,
  isBashToolInput,
} from '@ptah-extension/shared';
import {
  describeToolChips,
  describeToolTarget,
  displayToolName,
  isJustToolName,
  isPtahMcpToolName,
  splitMcpToolName,
} from '../../utils/tool-target.utils';
import { toolStatusPresentation } from '../../utils/tool-status.utils';

/**
 * ToolCallHeaderComponent - One log line per tool call (Direction A)
 *
 * Complexity Level: 2 (Molecule - composition of atoms)
 * Patterns: Composition pattern, event delegation
 *
 * Layout: `[tool name] [primary] [chips] [started] [failed] ... [chevron]
 * [duration]`
 * - The status words come from `toolStatusPresentation`, the same mapping
 *   that colours the item's rail, so the two cannot drift; a pending
 *   permission (`awaitingPermission`) reads "Awaiting permission", not
 *   "Failed"
 * - Toggle `<button>` (`aria-expanded`, `aria-controls` while expanded)
 * - The status is read out as text (`sr-only`); its colour is the left rail
 *   the orchestrator (`ptah-tool-call-item`) draws, so it shows once. No
 *   second streaming sentence replaces the header text
 * - Tool name once: built-in tools in muted mono; other MCP servers as a
 *   muted `server ·` prefix and the tool name; Ptah tools as a gold "Ptah"
 *   chip and the short name
 * - Deviation from Direction A: an MCP call's first argument is not put in
 *   the header; every argument goes to the body's "Arguments", because a
 *   header argument would repeat there
 * - Primary: the file name only, bold (full path in `title`), a
 *   command's description, a pattern, URL, query or summary. A command with
 *   no description shows its first line only while collapsed; expanded, the
 *   body's "Command" block has it, so the header shows no target. A primary
 *   that only repeats the tool name is left out
 * - Chips (`describeToolChips`): `background`, `60 min`, `lines 1-60`, ...
 * - A `run_in_background` command that has completed adds the word
 *   `started` after the chips (it started; it has not finished its work)
 * - A real failure adds a `failed` chip (Direction A's table says `exit
 *   failed`; `ExecutionNode` has no exit code, so it says `failed`)
 * - "Open <file>" is a 28 px sibling button (buttons do not nest) that opens
 *   through `FILE_LINK_OPENER`
 * - Text truncates with an ellipsis; nothing scrolls sideways. The tool name
 *   and target form one lead group that claims up to 12rem first; chips that
 *   do not fit beside it wrap to a second line, and the chevron, duration and
 *   Open button never shrink, so they stay in the row at 360 px
 * - Muted text (tool name, MCP server, "started") turns
 *   `text-base-content` while the toggle is hovered or focused: muted text on
 *   `--surface-highlight` measured under 4.5:1. In light themes the gold
 *   "Ptah" chip sits on `bg-base-100` so `--ptah-gold-strong` clears 4.5:1
 */
@Component({
  selector: 'ptah-tool-call-header',
  standalone: true,
  imports: [LucideAngularModule, DurationBadgeComponent],
  template: `
    <div class="group flex items-start min-w-0">
      <button
        #toggle
        type="button"
        class="group/toggle flex-1 min-w-0 min-h-7 px-1 py-0.5 flex items-center gap-2 text-xs text-left rounded hover:bg-[var(--surface-highlight)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content cursor-pointer"
        (click)="toggleClicked.emit()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="isCollapsed() ? null : 'tool-' + node().id"
      >
        <!-- Status in words; the item's rail carries the colour -->
        <span class="sr-only" data-testid="tool-status">{{
          statusLabel()
        }}</span>

        <!-- Everything but the chevron and duration. It wraps: chips that do
             not fit move to a second line, so the target keeps its room and
             the chevron never leaves the row. -->
        <span
          class="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5"
          data-testid="tool-header-content"
        >
          <!-- Tool name and primary target stay together on the first line;
               the group claims up to 12rem before any chip, and the target
               truncates inside it. -->
          <span
            class="flex items-center gap-2 min-w-0 max-w-max grow basis-48"
            data-testid="tool-header-lead"
          >
            <!-- Tool name, once -->
            @if (isPtahMcpTool()) {
              <span
                class="badge badge-sm h-5 px-1.5 text-[11px] font-semibold flex-shrink-0 bg-[var(--ptah-gold-soft)] [[data-theme-mode=light]_&]:bg-base-100 text-[color:var(--ptah-gold-strong)] border border-[color:var(--ptah-gold)]"
                data-testid="tool-ptah-chip"
                >Ptah</span
              >
              <span
                class="min-w-0 truncate font-semibold text-base-content"
                data-testid="tool-name"
                >{{ ptahToolName() }}</span
              >
            } @else if (mcpTool(); as mcp) {
              <span class="min-w-0 truncate" data-testid="tool-name">
                <span
                  class="text-base-content-muted group-hover/toggle:text-base-content group-focus-visible/toggle:text-base-content"
                  >{{ mcp.server }} ·</span
                >
                <span class="ml-1 font-semibold text-base-content">{{
                  mcp.tool
                }}</span>
              </span>
            } @else {
              <span
                class="font-mono text-base-content-muted group-hover/toggle:text-base-content group-focus-visible/toggle:text-base-content flex-shrink-0"
                data-testid="tool-name"
                >{{ node().toolName }}</span
              >
            }

            <!-- Primary: file, or the call's target -->
            @if (filePath()) {
              <span
                class="min-w-0 truncate font-semibold text-base-content"
                [title]="filePath()"
                data-testid="tool-file-path"
                >{{ fileName() }}</span
              >
            } @else if (targetLabel()) {
              <span
                class="min-w-0 truncate text-base-content"
                [class.font-mono]="isPatternTarget()"
                [title]="fullDescription()"
                data-testid="tool-target"
                >{{ targetLabel() }}</span
              >
            }
          </span>

          @for (chip of chips(); track $index) {
            <span
              class="badge badge-ghost badge-sm h-5 px-1.5 font-mono text-[11px] text-base-content-muted flex-shrink-0 max-w-full truncate"
              [attr.title]="chip.title ?? null"
              data-testid="tool-chip"
              >{{ chip.label }}</span
            >
          }

          @if (backgroundStarted()) {
            <span
              class="text-[11px] text-base-content-muted group-hover/toggle:text-base-content group-focus-visible/toggle:text-base-content flex-shrink-0"
              data-testid="tool-started"
              >started</span
            >
          }

          <!-- Parse Error Warning -->
          @if (hasParseError()) {
            <span
              class="flex items-center gap-1 flex-shrink-0 px-1.5 py-0.5 bg-warning/20 rounded text-base-content"
              [title]="'Parse Error: ' + parseError()"
            >
              <lucide-angular
                [img]="AlertIcon"
                class="w-3 h-3 text-warning"
                aria-hidden="true"
              />
              <span class="text-[11px] font-mono">Parse Error</span>
            </span>
          }

          <!-- The failure in words: colour is never the only signal -->
          @if (statusPresentation().failed) {
            <span
              class="badge badge-ghost badge-sm h-5 px-1.5 text-[11px] text-base-content flex-shrink-0"
              aria-hidden="true"
              data-testid="tool-failed"
              >failed</span
            >
          }
        </span>

        <!-- Chevron: always in the DOM, shown on hover and focus -->
        <lucide-angular
          [img]="ChevronIcon"
          class="w-3 h-3 flex-shrink-0 text-base-content-muted transition-transform motion-reduce:transition-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          [class.-rotate-90]="isCollapsed()"
          aria-hidden="true"
          data-testid="tool-chevron"
        />

        <!-- Duration -->
        @if (node().duration) {
          <ptah-duration-badge
            class="flex-shrink-0"
            [durationMs]="node().duration!"
          />
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallHeaderComponent {
  private readonly opener = inject(FILE_LINK_OPENER);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = input.required<boolean>();
  /** A permission request for this call is waiting on the user. */
  readonly awaitingPermission = input(false);
  readonly toggleClicked = output<void>();
  readonly ChevronIcon = ChevronDown;
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

  /** Last path segment, the only part of the path the row shows. */
  protected readonly fileName = computed(() => {
    const path = this.filePath().replaceAll('\\', '/');
    return path.slice(path.lastIndexOf('/') + 1);
  });

  /** A shell command call: the Bash tool, or any input carrying `command`. */
  protected readonly isCommandTool = computed(
    () =>
      this.node().toolName === 'Bash' || isBashToolInput(this.node().toolInput),
  );

  /**
   * A `run_in_background` call. The one flag behind both the `started` word
   * and the "Command started" label, so the two cannot disagree.
   */
  private readonly runsInBackground = computed(
    () => this.node().toolInput?.['run_in_background'] === true,
  );

  /** Rail colour, words and failure flag for this call's state. */
  protected readonly statusPresentation = computed(() =>
    toolStatusPresentation(this.node().status, {
      command: this.isCommandTool(),
      awaitingPermission: this.awaitingPermission(),
      background: this.runsInBackground(),
    }),
  );

  /** The status in words (`toolStatusPresentation`). */
  protected readonly statusLabel = computed(
    () => this.statusPresentation().label,
  );

  /** A background call that has completed: it has started, not finished. */
  protected readonly backgroundStarted = computed(
    () =>
      this.node().status === 'complete' &&
      this.runsInBackground() &&
      !this.awaitingPermission(),
  );

  private readonly toolTarget = computed(() =>
    describeToolTarget(this.node().toolName || '', this.node().toolInput),
  );

  protected readonly chips = computed(
    () =>
      describeToolChips(this.node().toolName || '', this.node().toolInput)
        .chips,
  );

  /**
   * The primary text. A command shows its description; with none, its first
   * line while collapsed and nothing while expanded (the body's "Command"
   * block then holds the full text). A label that only repeats the tool name
   * is dropped.
   */
  protected readonly targetLabel = computed(() => {
    const input = this.node().toolInput;
    if (isBashToolInput(input)) {
      if (input.description) return input.description;
      return this.isCollapsed() ? input.command.split(/\r\n|\r|\n/)[0] : '';
    }
    const label = this.toolTarget().short;
    return isJustToolName(label, this.node().toolName || '') ? '' : label;
  });

  /** Search patterns read as code. */
  protected readonly isPatternTarget = computed(() =>
    this.toolTarget().keys.includes('pattern'),
  );

  /** Full target for the primary's `title`. */
  protected readonly fullDescription = computed(
    () => this.toolTarget().full || this.targetLabel(),
  );

  protected readonly mcpTool = computed(() =>
    splitMcpToolName(this.node().toolName || ''),
  );

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
  protected ptahToolName(): string {
    return displayToolName(this.node().toolName || '');
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
