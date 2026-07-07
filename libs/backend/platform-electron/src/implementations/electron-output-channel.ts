/**
 * ElectronOutputChannel — IOutputChannel implementation for Electron.
 *
 * Writes log messages to a per-day file with timestamps and also mirrors to
 * console. Files are named `${name}-YYYY-MM-DD.log` and roll over automatically
 * when the calendar day changes, so no single file grows unbounded.
 *
 * Log file location is determined by the logDir passed via constructor
 * (typically app.getPath('logs') from the Electron app).
 *
 * No direct 'electron' imports — log directory is injected via constructor.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IOutputChannel } from '@ptah-extension/platform-core';

export class ElectronOutputChannel implements IOutputChannel {
  readonly name: string;
  private readonly logDir: string;
  private logStream: fs.WriteStream;
  private currentDate: string;
  private isDisposed = false;

  constructor(name: string, logDir: string) {
    this.name = name;
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });
    this.currentDate = ElectronOutputChannel.today();
    this.logStream = this.openStream('a');
  }

  appendLine(message: string): void {
    if (this.isDisposed) return;
    this.rollIfNeeded();
    const line = `[${new Date().toISOString()}] ${message}\n`;
    this.logStream.write(line);
  }

  append(message: string): void {
    if (this.isDisposed) return;
    this.rollIfNeeded();
    this.logStream.write(message);
  }

  clear(): void {
    if (this.isDisposed) return;
    this.logStream.end();
    this.logStream = this.openStream('w');
  }

  show(): void {
    console.log(
      `[${this.name}] Output channel shown (log file: ${this.logStream.path})`,
    );
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.logStream.end();
  }

  /** Current local date as `YYYY-MM-DD`, used as the log-file suffix. */
  private static today(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private logPathForCurrentDate(): string {
    return path.join(this.logDir, `${this.name}-${this.currentDate}.log`);
  }

  private openStream(flags: 'a' | 'w'): fs.WriteStream {
    return fs.createWriteStream(this.logPathForCurrentDate(), { flags });
  }

  /** Close the current stream and open a new one when the day has changed. */
  private rollIfNeeded(): void {
    const today = ElectronOutputChannel.today();
    if (today === this.currentDate) return;
    this.logStream.end();
    this.currentDate = today;
    this.logStream = this.openStream('a');
  }
}
