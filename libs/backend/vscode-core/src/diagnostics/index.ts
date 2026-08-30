export {
  EventLoopMonitor,
  EVENT_LOOP_LAG_WARN_MS_ENV,
  DEFAULT_EVENT_LOOP_LAG_WARN_MS,
  DEFAULT_EVENT_LOOP_SAMPLE_INTERVAL_MS,
} from './event-loop-monitor';
export type {
  EventLoopLagSample,
  EventLoopLagListener,
  EventLoopMonitorOptions,
} from './event-loop-monitor';

export {
  CpuProfileCapture,
  CPU_PROFILE_ON_LAG_MS_ENV,
  CPU_PROFILE_DIR_ENV,
  DEFAULT_CPU_PROFILE_DURATION_MS,
  AUTO_CAPTURE_COOLDOWN_MS,
} from './cpu-profile-capture';

export { armDiagnostics } from './arm-diagnostics';
export type {
  ArmDiagnosticsOptions,
  DiagnosticsHandle,
} from './arm-diagnostics';

export { readMsEnv, roundMs } from './env-thresholds';
