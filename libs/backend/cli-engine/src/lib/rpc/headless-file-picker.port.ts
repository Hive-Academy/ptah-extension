/**
 * Headless file-picker port.
 *
 * `file:pick` means "ask the user to choose workspace files". The webview
 * hosts satisfy that with a native modal dialog; a headless host has no such
 * thing, so the selection UI has to come from whatever owns the terminal.
 *
 * The engine therefore depends on this port rather than on any UI: the TUI
 * registers an implementation backed by its Ink overlay, and the stdio CLI
 * registers none (its profile leaves the `filePicker` capability off, so the
 * method is never registered in the first place).
 */

export interface HeadlessFilePickRequest {
  /** Allow more than one file to be chosen. */
  readonly multiple: boolean;
}

export interface IHeadlessFilePicker {
  /**
   * Resolve with the absolute paths the user chose, or an empty array when
   * they cancelled. Must not reject — cancellation is an empty selection,
   * matching the desktop hosts' behaviour on a dismissed dialog.
   */
  pickFiles(request: HeadlessFilePickRequest): Promise<readonly string[]>;
}

export const HEADLESS_FILE_PICKER = Symbol.for('HeadlessFilePicker');
