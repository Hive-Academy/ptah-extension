/**
 * IOutputChannel — Platform-agnostic logging output channel.
 *
 * Replaces: vscode.OutputChannel
 */

import type { IDisposable } from '../types/platform.types';

export interface IOutputChannel extends IDisposable {
  readonly name: string;
  appendLine(message: string): void;
  append(message: string): void;
  clear(): void;
  show(): void;
}
