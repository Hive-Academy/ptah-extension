import * as vscode from 'vscode';

export class Logger {
  private static outputChannel: vscode.OutputChannel;

  static initialize(): void {
    if (!Logger.outputChannel) {
      Logger.outputChannel = vscode.window.createOutputChannel('Ptah');
    }
  }

  static info(message: string, ...args: any[]): void {
    Logger.initialize();
    const logMessage = `[INFO] ${new Date().toISOString()} - ${message}`;
    Logger.outputChannel.appendLine(logMessage);
    if (args.length > 0) {
      console.log(logMessage, ...args);
    } else {
      console.log(logMessage);
    }
  }

  static warn(message: string, ...args: any[]): void {
    Logger.initialize();
    const logMessage = `[WARN] ${new Date().toISOString()} - ${message}`;
    Logger.outputChannel.appendLine(logMessage);
    if (args.length > 0) {
      console.warn(logMessage, ...args);
    } else {
      console.warn(logMessage);
    }
  }

  static error(message: string, error?: any): void {
    Logger.initialize();
    const logMessage = `[ERROR] ${new Date().toISOString()} - ${message}`;
    Logger.outputChannel.appendLine(logMessage);

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : '';
      Logger.outputChannel.appendLine(`Error details: ${errorMessage}`);
      if (stackTrace) {
        Logger.outputChannel.appendLine(`Stack trace: ${stackTrace}`);
      }
      console.error(logMessage, error);
    } else {
      console.error(logMessage);
    }
  }

  static debug(message: string, ...args: any[]): void {
    Logger.initialize();
    const logMessage = `[DEBUG] ${new Date().toISOString()} - ${message}`;
    Logger.outputChannel.appendLine(logMessage);
    if (args.length > 0) {
      console.debug(logMessage, ...args);
    } else {
      console.debug(logMessage);
    }
  }

  static show(): void {
    Logger.initialize();
    Logger.outputChannel.show();
  }

  static dispose(): void {
    Logger.outputChannel?.dispose();
  }
}
