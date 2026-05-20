export interface ITranscriptReader {
  read(sessionId: string, workspacePath: string): Promise<string>;
}
