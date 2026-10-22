export interface McpAttachment {
  readonly agentId: string;
  readonly method: 'initialize' | 'tools/list';
  readonly port: number;
  readonly time: number;
}

export interface IMcpAttachmentProbe {
  get(agentId: string, port: number): McpAttachment | undefined;
  waitFor(
    agentId: string,
    port: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<McpAttachment | undefined>;
}

export const MCP_ATTACHMENT_TIMEOUT_MS = 15_000;
