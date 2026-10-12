'use strict';
/**
 * Ptah patch (TASK_2026_625): `child_process` with `windowsHide: true` as the
 * default.
 *
 * `scripts/patch-windows-hide-deps.js` copies this file into third-party
 * packages that spawn console programs with no spawn-options hook
 * (`@openai/codex-sdk`, `@cursor/sdk`) and points their `child_process` import
 * here. Without it, each such spawn from Electron's console-less main process
 * opens a new, visible console window on Windows.
 *
 * A caller that sets `windowsHide` itself (true or false) keeps its value. The
 * flag is ignored off Windows.
 */

const childProcess = require('node:child_process');
const util = require('node:util');

/** `spawn`, `spawnSync`, `execFile`, `execFileSync`, `fork`: (file, args?, options?, ...). */
function optionsIndexAfterArgs(args) {
  const second = args[1];
  return Array.isArray(second) || (second == null && args.length > 2) ? 2 : 1;
}

/** `exec`, `execSync`: (command, options?, ...). */
function optionsIndexAfterCommand() {
  return 1;
}

/**
 * Copy of `args` with `windowsHide: true` in the options slot, unless the
 * caller already set the key. A callback in the options slot (for example
 * `execFile(file, args, callback)`) moves one place right.
 */
function withHiddenWindow(args, optionsIndex) {
  const next = Array.prototype.slice.call(args);
  const candidate = next[optionsIndex];
  if (candidate == null) {
    next[optionsIndex] = { windowsHide: true };
  } else if (typeof candidate === 'function') {
    next.splice(optionsIndex, 0, { windowsHide: true });
  } else if (
    typeof candidate === 'object' &&
    !Array.isArray(candidate) &&
    candidate.windowsHide === undefined
  ) {
    next[optionsIndex] = Object.assign({}, candidate, { windowsHide: true });
  }
  return next;
}

function hideWindow(original, optionsIndexOf) {
  const wrapped = function () {
    return original.apply(
      this,
      withHiddenWindow(arguments, optionsIndexOf(arguments)),
    );
  };
  // `util.promisify(exec|execFile)` resolves `{ stdout, stderr }` only through
  // this hook. Keep it, with the same default.
  const custom = original[util.promisify.custom];
  if (typeof custom === 'function') {
    wrapped[util.promisify.custom] = function () {
      return custom.apply(
        this,
        withHiddenWindow(arguments, optionsIndexOf(arguments)),
      );
    };
  }
  return wrapped;
}

function createWindowsHideChildProcess(cp) {
  return Object.assign({}, cp, {
    spawn: hideWindow(cp.spawn, optionsIndexAfterArgs),
    spawnSync: hideWindow(cp.spawnSync, optionsIndexAfterArgs),
    execFile: hideWindow(cp.execFile, optionsIndexAfterArgs),
    execFileSync: hideWindow(cp.execFileSync, optionsIndexAfterArgs),
    fork: hideWindow(cp.fork, optionsIndexAfterArgs),
    exec: hideWindow(cp.exec, optionsIndexAfterCommand),
    execSync: hideWindow(cp.execSync, optionsIndexAfterCommand),
  });
}

module.exports = createWindowsHideChildProcess(childProcess);
// For the unit tests. Not enumerable, so the module keeps the shape of
// `child_process`.
Object.defineProperty(module.exports, 'createWindowsHideChildProcess', {
  value: createWindowsHideChildProcess,
  enumerable: false,
});
