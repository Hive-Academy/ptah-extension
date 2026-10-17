/** Notices for SDK tasks stopped by Ptah's subagent budget monitor. */
export class SubagentStopNotices {
  private readonly byTaskId = new Map<
    string,
    { readonly sessionId: string; readonly text: string }
  >();

  record(sessionId: string, taskId: string, text: string): void {
    this.byTaskId.set(taskId, { sessionId, text });
  }

  noticeFor(taskId: string): string | undefined {
    return this.byTaskId.get(taskId)?.text;
  }

  forgetSession(sessionId: string): void {
    for (const [taskId, notice] of this.byTaskId) {
      if (notice.sessionId === sessionId) this.byTaskId.delete(taskId);
    }
  }
}
