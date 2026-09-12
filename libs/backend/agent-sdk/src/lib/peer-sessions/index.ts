/**
 * Peer-session addressing (TASK_2026_402, Batch 10).
 *
 * Two capabilities over the Claude CLI's own session registry: list the
 * sessions this user can reach, and hand one a message. The second reports
 * ACCEPTANCE by the transport and never delivery — see
 * `peer-session-messenger.service.ts` for why no route can do better.
 */

export {
  PeerSessionRecordSchema,
  currentPidDomain,
  peerSessionRegistryDirectory,
  recordStartFingerprint,
  scanPeerSessionRegistry,
  type PeerSessionRecord,
  type PeerSessionRegistryScan,
  type UnreadablePeerSessionFile,
} from './peer-session-registry.reader';

export {
  POSIX_START_TIME_TOLERANCE_MS,
  ProcessStartTimeProbe,
  WINDOWS_START_TIME_TOLERANCE_MS,
  buildWindowsProbeScript,
  decodeStartFingerprint,
  parsePosixProbeOutput,
  parseWindowsProbeOutput,
  type ProbeCommandRunner,
  type ProcessStartTimes,
} from './process-start-time.probe';

export {
  PeerSessionDirectory,
  resolveName,
  resolveUnreachableReason,
  unreadableRow,
  type PeerSessionListOptions,
  type ReachabilityContext,
} from './peer-session-directory.service';

export {
  PEER_SEND_ACCEPTANCE_CAVEAT,
  composePeerMessageRequest,
  type PeerMessageTarget,
} from './peer-message.composer';

export {
  MAX_PEER_MESSAGE_LENGTH,
  PeerSessionMessenger,
  type PeerSessionSendInput,
} from './peer-session-messenger.service';
