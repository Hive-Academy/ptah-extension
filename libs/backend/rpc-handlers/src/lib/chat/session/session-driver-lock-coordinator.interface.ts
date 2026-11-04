import type { SessionDriverLockCoordinator } from './session-driver-lock-coordinator';

/** Operations needed by chat session orchestration. */
export type ChatSessionDriverLock = Pick<
  SessionDriverLockCoordinator,
  | 'beginRecordAdmission'
  | 'endRecordAdmission'
  | 'beginDrive'
  | 'abandonDrive'
  | 'settleDrive'
  | 'assertDriveHeld'
  | 'admitNative'
  | 'assertRecordAdmission'
>;
