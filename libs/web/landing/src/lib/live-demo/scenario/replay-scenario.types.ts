import type {
  AgentOutputDelta,
  AgentProcessInfo,
  FlatStreamEventUnion,
  MessagePayloadMap,
  PermissionRequest,
  RpcMethodName,
  RpcMethodParams,
  RpcMethodResult,
  SessionStatsLiveWire,
  ViewChangedPayload,
} from '@ptah-extension/shared';

/** Branded IDs are plain strings on the JSON wire. Preserve other literal unions. */
type JsonWire<T> = T extends string
  ? T extends { readonly __brand: string } ? string : T
  : T extends readonly (infer Item)[] ? JsonWire<Item>[]
  : T extends object ? { [K in keyof T]: JsonWire<T[K]> }
  : T;

/** A JSON fixture is immutable after loading; readonly arrays preserve literal inference. */
export type ScenarioRpc = {
  readonly [M in RpcMethodName]?: JsonWire<RpcMethodResult<M>>;
};

export type ScenarioRpcCases = {
  readonly [M in RpcMethodName]?: readonly {
    readonly match: Partial<JsonWire<RpcMethodParams<M>>>;
    readonly data: JsonWire<RpcMethodResult<M>>;
  }[];
};

export type ScenarioRpcErrors = {
  readonly [M in RpcMethodName]?: {
    readonly error: string;
    readonly errorCode?: string;
  };
};

type SharedPush<K extends keyof MessagePayloadMap> = {
  readonly type: K;
  readonly payload: MessagePayloadMap[K];
};

type MappedPush = {
  [K in
    | 'chat:streamSnapshot'
    | 'session:turnEnded'
    | 'session:subagentEnded'
    | 'agentSession:opened'
    | 'sessionHandoff:opened'
    | 'planLimits:changed'
    | 'workspaceChanged']: SharedPush<K>;
}[
  | 'chat:streamSnapshot'
  | 'session:turnEnded'
  | 'session:subagentEnded'
  | 'agentSession:opened'
  | 'sessionHandoff:opened'
  | 'planLimits:changed'
  | 'workspaceChanged'];

type LocalPush =
  | { readonly type: 'chat:chunk'; readonly payload: { readonly tabId?: string; readonly sessionId?: string; readonly event: JsonWire<FlatStreamEventUnion> } }
  | { readonly type: 'chat:complete'; readonly payload: { readonly sessionId?: string; readonly tabId?: string; readonly command?: string } }
  | { readonly type: 'session:id-resolved'; readonly payload: { readonly sessionId?: string; readonly realSessionId: string; readonly tabId?: string } }
  | { readonly type: 'session:stats-live'; readonly payload: SessionStatsLiveWire }
  | { readonly type: 'agent-monitor:spawned'; readonly payload: JsonWire<AgentProcessInfo> }
  | { readonly type: 'agent-monitor:output'; readonly payload: JsonWire<AgentOutputDelta> }
  | { readonly type: 'agent-monitor:exited'; readonly payload: JsonWire<AgentProcessInfo> }
  | { readonly type: 'permission:request'; readonly payload: PermissionRequest };

type SwitchViewPush = {
  readonly type: 'switchView';
  readonly payload: ViewChangedPayload;
};

export type ReplayTimelineMessage = MappedPush | LocalPush | SwitchViewPush | {
  readonly type: 'batch';
  readonly payload: { readonly events: readonly (MappedPush | LocalPush | SwitchViewPush)[] };
};

export type ReplayMessage = ReplayTimelineMessage;

export interface ReplayScenario {
  readonly id: string;
  readonly title: string;
  readonly timeBase: number;
  readonly config: {
    readonly initialView: 'chat' | 'command-center';
    readonly workspaceRoot: string;
    readonly workspaceName: string;
  };
  readonly rpc: ScenarioRpc;
  readonly rpcCases?: ScenarioRpcCases;
  readonly rpcErrors?: ScenarioRpcErrors;
  readonly bootMessages?: readonly ReplayTimelineMessage[];
  readonly start?: { readonly mode: 'auto' } | { readonly mode: 'on-send'; readonly prompt: string };
  readonly timeline: readonly { readonly at: number; readonly message: ReplayTimelineMessage }[];
}
