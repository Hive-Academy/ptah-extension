import { NullSessionDriverLock } from '../../session-driver-lock/null-session-driver-lock';
import { runSessionDriverLockContract } from './run-session-driver-lock-contract';

runSessionDriverLockContract('null', () => new NullSessionDriverLock());
