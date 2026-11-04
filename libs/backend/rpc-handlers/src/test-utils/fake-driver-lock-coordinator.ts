import type { ChatSessionDriverLock } from '../lib/chat/session/session-driver-lock-coordinator.interface';

export function createFakeDriverLockCoordinator(): jest.Mocked<ChatSessionDriverLock> {
  return {
    beginRecordAdmission: jest.fn(),
    endRecordAdmission: jest.fn(),
    beginDrive: jest.fn().mockResolvedValue('drive-attempt'),
    abandonDrive: jest.fn().mockResolvedValue(undefined),
    settleDrive: jest.fn().mockResolvedValue(undefined),
    admitNative: jest.fn().mockResolvedValue({ release: jest.fn() }),
    assertDriveHeld: jest.fn().mockResolvedValue(undefined),
    assertRecordAdmission: jest.fn().mockResolvedValue(undefined),
  };
}
