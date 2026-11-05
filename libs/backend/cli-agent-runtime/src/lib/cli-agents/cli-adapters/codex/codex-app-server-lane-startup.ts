/**
 * Bound for each startup step (context open, turn start). Context open spawns
 * the App Server and runs `thread/start`, where Codex connects its MCP
 * servers, Ptah's own included, so a busy host stretches it. The bound stays
 * at 30 s on purpose: `ptah_agent_spawn` awaits context open before it
 * returns the agent id, so a longer bound would let the caller's request time
 * out with no id. Raise it only after spawn returns before context open
 * (TASK_2026_882_01ef follow-up).
 */
export const CODEX_LANE_STARTUP_TIMEOUT_MS = 30_000;

/** Bound both context open and turn start; never leave a timer after settlement. */
export async function withCodexLaneStartupTimeout<T>(
  operation: Promise<T>,
  abort: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(
            new Error(
              `Codex App Server startup timed out after ${CODEX_LANE_STARTUP_TIMEOUT_MS / 1000}s`,
            ),
          );
        }, CODEX_LANE_STARTUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
