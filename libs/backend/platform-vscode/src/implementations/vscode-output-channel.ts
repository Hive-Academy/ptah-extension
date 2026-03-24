/**
 * VscodeOutputChannel — IOutputChannel implementation wrapping vscode.OutputChannel.
 */

import * as vscode from 'vscode';
import type { IOutputChannel } from '@ptah-extension/platform-core';

export class VscodeOutputChannel implements IOutputChannel {
  private readonly channel: vscode.OutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  get name(): string {
    return this.channel.name;
  }

  appendLine(message: string): void {
    this.channel.appendLine(message);
  }

  append(message: string): void {
    this.channel.append(message);
  }

  clear(): void {
    this.channel.clear();
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}
