/** Commands and documentation shown in the Codex setup surfaces. */
export const CODEX_SIGN_IN_COMMAND = 'codex login';
export const CODEX_SETUP_DOCS_URL = 'https://developers.openai.com/codex/cli';
export type CodexInstallTab = 'npm' | 'brew';
export interface CodexInstallCommand {
  readonly id: CodexInstallTab;
  readonly tab: CodexInstallTab;
  readonly label: string;
  readonly command: string;
}
export const CODEX_INSTALL_COMMANDS: readonly CodexInstallCommand[] = [
  { id: 'npm', tab: 'npm', label: 'npm', command: 'npm install -g @openai/codex' },
  { id: 'brew', tab: 'brew', label: 'Homebrew', command: 'brew install --cask codex' },
];

/** A copyable terminal command for the selected binary; null means offer no command sentence. */
export function codexTerminalLoginCommand(
  binary: { readonly path: string; readonly source: 'installed' | 'bundled' },
  platform: string,
): string | null {
  if (platform === 'win32' || !binary.path || binary.path.includes('"')) return null;
  if (binary.source === 'installed') return CODEX_SIGN_IN_COMMAND;
  return `'${binary.path.replace(/'/g, "'\\''")}' login`;
}
