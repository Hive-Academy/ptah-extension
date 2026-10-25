export type CodexParityConsumer = 'chat' | 'gateway' | 'lane';
export interface CodexParityPlatform {
  readonly platform: string;
  readonly arch: string;
}
export interface CodexParityObservation {
  readonly id: string;
  readonly observation: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly status: 'proved' | 'unproved' | 'unsupported';
  readonly evidence: string;
}

/** Reviewed static evidence, not schema coverage or unit-test coverage.
 * Sources are relative to .ptah/specs/TASK_2026_714_c8a2/.
 * None of the seven complete observations is proved (native-route-evidence.md).
 * Later runs refine individual behaviors without certifying the whole observation.
 */
export const CODEX_PARITY_EVIDENCE: readonly CodexParityObservation[] =
  Object.freeze(
    (
      [
        {
          id: 'handshake-schemas-outcomes-binary',
          observation: 1,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 1; spike-run-3.json through spike-run-5.json: partial only',
        },
        {
          id: 'permission-matrix',
          observation: 2,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 2; questions and plan transitions remain unproved',
        },
        {
          id: 'command-accept',
          observation: 2,
          status: 'proved',
          evidence:
            'spike-run-6e.json: ask-before-effect under granular + read-only',
        },
        {
          id: 'command-deny',
          observation: 2,
          status: 'proved',
          evidence: 'spike-run-6f.json: denied command has no effect',
        },
        {
          id: 'file-accept',
          observation: 2,
          status: 'proved',
          evidence: 'spike-run-6h.json: file-change accept',
        },
        {
          id: 'file-deny',
          observation: 2,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 2; file accept alone is insufficient',
        },
        {
          id: 'plan-read-only',
          observation: 2,
          status: 'proved',
          evidence: 'spike-run-6h.json: plan read-only boundary',
        },
        {
          id: 'auto-edit-boundary',
          observation: 2,
          status: 'proved',
          evidence: 'spike-run-6h.json: auto-edit boundary',
        },
        {
          id: 'mcp-approval',
          observation: 2,
          status: 'proved',
          evidence:
            'spike-run-6i.json; decisions.md: mcpServer/elicitation/request accept',
        },
        {
          id: 'mcp-deny',
          observation: 2,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 2; MCP accept does not prove denial',
        },
        {
          id: 'edit-decline-and-steer',
          observation: 2,
          status: 'proved',
          evidence:
            'spike-run-6j.json: decline before effect and same-turn steer; decisions.md: accepted replacement contract, NOT native edited-input approval',
        },
        {
          id: 'always-allow-scope',
          observation: 2,
          status: 'unproved',
          evidence:
            'batches.md: C3; acceptForSession does not prove Ptah remembered-rule scope',
        },
        {
          id: 'yolo-full-access',
          observation: 2,
          status: 'unproved',
          evidence:
            'batches.md: C7; spike-run-6h.json used workspace-write + on-request, not full access',
        },
        {
          id: 'profile-inputs',
          observation: 3,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 3; skills, instructions, output style, attachments, model/effort/max and resume roles',
        },
        {
          id: 'remote-mcp',
          observation: 3,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 3; offline configuration is not remote behavior',
        },
        {
          id: 'configuration-auth-usage-isolation',
          observation: 4,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 4; all consumer pairs, different homes and no shared-home writes',
        },
        {
          id: 'stream-usage-controls',
          observation: 5,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 5; partial behavior does not certify complete lifecycle',
        },
        {
          id: 'yolo-interrupt',
          observation: 5,
          status: 'proved',
          evidence:
            'spike-run-6h.json: interrupt under workspace-write + on-request only',
        },
        {
          id: 'history-rewind',
          observation: 5,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 5; resume/history/pages/stats and actual scoped file restoration',
        },
        {
          id: 'compaction',
          observation: 5,
          status: 'proved',
          evidence:
            'spike-run-6e.json: result 9; native-route-evidence.md: run 6e records compaction observed (later than the required-observations table)',
        },
        {
          id: 'subagents',
          observation: 5,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 5; required subagent controls unverified',
        },
        {
          id: 'lane-restrictions-lifecycle',
          observation: 6,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 6; budgets, role resend, headless policy, Windows completion and abort',
        },
        {
          id: 'packaged-binaries',
          observation: 7,
          status: 'unproved',
          evidence:
            'native-route-evidence.md: Required observations, row 7; win32/x64 development digest is insufficient',
        },
      ] satisfies CodexParityObservation[]
    ).map((entry) => Object.freeze(entry)),
  );

export interface CodexParityDecision {
  readonly consumer: CodexParityConsumer;
  readonly platform: Readonly<CodexParityPlatform>;
  /** Batch 2k cannot authorize production routing, even with future ledger edits. */
  readonly enabled: false;
  readonly reason: 'production-routing-disabled';
  readonly unproved: readonly CodexParityObservation[];
}

/** No I/O, environment probes, executable launches or caller-supplied evidence. */
export class CodexParityGate {
  evaluate(
    consumer: CodexParityConsumer,
    platform: CodexParityPlatform,
  ): CodexParityDecision {
    const unproved = CODEX_PARITY_EVIDENCE.filter(
      (entry) => entry.status !== 'proved',
    );
    // C9: the only reviewed development row is win32/x64. It is not packaging proof.
    if (platform.platform !== 'win32' || platform.arch !== 'x64') {
      unproved.push(
        Object.freeze({
          id: 'platform-manifest',
          observation: 7,
          status: 'unsupported',
          evidence:
            'codex-app-server-protocol.manifest.json: no reviewed row for this platform/architecture',
        }),
      );
    }
    return Object.freeze({
      consumer,
      platform: Object.freeze({ ...platform }),
      enabled: false,
      reason: 'production-routing-disabled',
      unproved: Object.freeze(unproved),
    });
  }

  isEnabled(
    consumer: CodexParityConsumer,
    platform: CodexParityPlatform,
  ): false {
    return this.evaluate(consumer, platform).enabled;
  }
}
