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

export {
  MainLoopWatchdog,
  appendHangLogLine,
  HANG_LOG_FILE_NAME,
  HANG_LOG_MAX_BYTES,
  MAX_WORKER_RESTARTS,
  WORKER_RESTART_WINDOW_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HANG_THRESHOLD_MS,
  DEFAULT_HANG_CHECK_INTERVAL_MS,
  MAX_BREADCRUMB_KEYS,
  MAX_BREADCRUMB_VALUE_LENGTH,
} from './main-loop-watchdog';
export type { MainLoopWatchdogOptions } from './main-loop-watchdog';

export {
  BackgroundWorkGovernor,
  DEFAULT_MAX_DEFER_MS,
  LAG_ENTER_P99_MS,
  LAG_ENTER_WINDOWS,
  LAG_EXIT_MAX_MS,
  LAG_EXIT_WINDOWS,
  LAG_FREEZE_MAX_MS,
} from './background-work-governor';
// `GovernorTimers` and `LagSampleSource` stop here, deliberately NOT in the
// package barrel (`src/index.ts`): the first is the governor spec's fake-clock
// seam, the second a narrowed `EventLoopMonitor` view only `attachLagSource`
// takes. Neither is a contract an adopter depends on.
export type {
  BackgroundWorkAdmission,
  BackgroundWorkSignal,
  BackgroundWorkState,
  BackgroundWorkStateListener,
  ForegroundActivitySource,
  GovernorTimers,
  LagSampleSource,
  WhenClearOptions,
  WhenClearOutcome,
} from './background-work-governor';

export { armDiagnostics } from './arm-diagnostics';
export type {
  ArmDiagnosticsOptions,
  DiagnosticsHandle,
} from './arm-diagnostics';

export { readMsEnv, roundMs } from './env-thresholds';
