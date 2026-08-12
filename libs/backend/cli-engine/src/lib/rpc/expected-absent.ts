/**
 * Expected-absent surface for the headless hosts (stdio CLI + TUI).
 *
 * The headless hosts run every backend subsystem, so nothing in the shared
 * handler library is off-limits — what they cannot serve are the webview-only
 * UI surfaces. There is no window to open a modal dialog on, no command
 * palette, no editor pane, no tile layout, no embedded terminal, and no
 * self-updating application shell.
 *
 * Turning one of these capabilities on in `cli-host-profile.ts` requires an
 * actual headless implementation first; until then the manifest has no
 * handler for the entry and boot fails loudly rather than half-registering.
 */

/**
 * Off on both headless hosts. `filePicker` is absent from this list because
 * the two hosts diverge on it — see {@link CLI_ONLY_ABSENT_CAPABILITIES}.
 */
export const EXPECTED_ABSENT_CAPABILITIES = [
  'fileOpen',
  'filePickerImages',
  'fileSystemAccess',
  'editorRevert',
  'editorHost',
  'commandExecution',
  'layoutPersistence',
  'pty',
  'appUpdater',
] as const;

/**
 * Off on the stdio CLI only. The TUI owns a terminal and can put a selection
 * list in front of the user, so it serves `file:pick` through
 * `IHeadlessFilePicker`; a piped `ptah` invocation has nobody to ask.
 */
export const CLI_ONLY_ABSENT_CAPABILITIES = ['filePicker'] as const;
