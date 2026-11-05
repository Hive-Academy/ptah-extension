import { runSessionDriverLockContract } from '../testing/contracts/run-session-driver-lock-contract';
import { NullSessionDriverLock } from './null-session-driver-lock';

runSessionDriverLockContract('null', () => new NullSessionDriverLock());
