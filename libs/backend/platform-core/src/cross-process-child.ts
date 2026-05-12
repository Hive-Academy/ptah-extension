/**
 * Cross-process child script for file-settings-manager.cross-process.spec.ts.
 *
 * This script is spawned via child_process.fork() by the parent test. It
 * receives IPC messages from the parent and writes settings to the shared
 * temp directory using PtahFileSettingsManager.
 *
 * Protocol (IPC messages):
 *   Parent -> Child: { type: 'set', key: string, value: unknown }
 *   Child -> Parent: { type: 'done', key: string }
 *   Child -> Parent: { type: 'error', message: string }
 *   Parent -> Child: { type: 'exit' }
 */

// Must use require() / CJS-compatible imports because this runs as a plain
// Node script via fork(). The tsconfig for the lib uses CommonJS output.
// We also need reflect-metadata for any DI imports that may come in.
import 'reflect-metadata';

import { PtahFileSettingsManager } from './file-settings-manager';

interface SetMessage {
  type: 'set';
  key: string;
  value: unknown;
  ptahDir: string; // We receive the temp dir via each message so the child stays stateless
}

interface ExitMessage {
  type: 'exit';
}

type InboundMessage = SetMessage | ExitMessage;

process.on('message', (msg: InboundMessage) => {
  if (msg.type === 'exit') {
    process.exit(0);
    return;
  }

  if (msg.type === 'set') {
    // Construct a manager pointing at the same temp directory.
    // We mock os.homedir indirectly by setting the HOME/USERPROFILE env vars
    // that the parent passes via the fork() env option.
    const mgr = new PtahFileSettingsManager({});

    mgr
      .set(msg.key, msg.value)
      .then(() => {
        process.send!({ type: 'done', key: msg.key });
      })
      .catch((err: unknown) => {
        process.send!({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }
});

// Signal readiness.
process.send!({ type: 'ready' });
