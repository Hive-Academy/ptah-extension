// Ptah patch (TASK_2026_625): the ESM face of
// ptah-windows-hide-child-process.cjs. The local exports below take precedence
// over the same names from `export *`.
import cp from './ptah-windows-hide-child-process.cjs';

export * from 'node:child_process';
export const {
  spawn,
  spawnSync,
  exec,
  execSync,
  execFile,
  execFileSync,
  fork,
} = cp;
export default cp;
