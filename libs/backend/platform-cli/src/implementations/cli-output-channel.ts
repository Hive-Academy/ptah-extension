/**
 * CliOutputChannel — IOutputChannel implementation for CLI.
 *
 * Writes log messages to a file with timestamps and also mirrors to console.
 * Log file location is determined by the logsPath passed via constructor
 * (typically ~/.ptah/logs/ for CLI applications).
 *
 * No external imports required — pure Node.js fs implementation.
 *
 * Copied from ElectronOutputChannel (identical logic, CLI class prefix).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IOutputChannel } from '@ptah-extension/platform-core';

export class CliOutputChannel implements IOutputChannel {
  readonly name: string;
  private logStream: fs.WriteStream;
  private isDisposed = false;

  constructor(name: string, logDir: string) {
    this.name = name;
    const logPath = path.join(logDir, `${name}.log`);
    // Ensure log directory exists
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  appendLine(message: string): void {
    if (this.isDisposed) return;
    const line = `[${new Date().toISOString()}] ${message}\n`;
    this.logStream.write(line);
    // Console output is handled by the CLI logger adapter when verbose is true.
    // Writing here too causes every log line to appear twice.
  }

  append(message: string): void {
    if (this.isDisposed) return;
    this.logStream.write(message);
  }

  clear(): void {
    if (this.isDisposed) return;
    // Close current stream and reopen with 'w' flag to truncate
    const logPath = this.logStream.path as string;
    this.logStream.end();
    this.logStream = fs.createWriteStream(logPath, { flags: 'w' });
  }

  show(): void {
    // In CLI, "show" logs the file path so the user can find it.
    console.log(
      `[${this.name}] Output channel shown (log file: ${this.logStream.path})`,
    );
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.logStream.end();
  }
}
