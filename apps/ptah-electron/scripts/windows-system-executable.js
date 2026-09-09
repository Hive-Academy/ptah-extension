const fs = require('node:fs');
const path = require('node:path');

function windowsPathKey(value) {
  return path.win32.normalize(value).toLowerCase();
}

function resolveWindowsSystemExecutable(
  relativePath,
  {
    platform = process.platform,
    environment = process.env,
    existsSync = fs.existsSync,
    statSync = fs.statSync,
    realpathSync = fs.realpathSync.native,
  } = {},
) {
  if (platform !== 'win32') {
    throw new Error('Windows system executable resolution requires Windows');
  }
  if (path.win32.isAbsolute(relativePath)) {
    throw new Error('Windows system executable path must be relative');
  }

  const roots = [environment.SystemRoot, environment.WINDIR].filter(Boolean);
  if (roots.length === 0 || roots.some((root) => !path.win32.isAbsolute(root))) {
    throw new Error('SystemRoot/WINDIR must identify an absolute Windows directory');
  }
  if (roots.some((root) => windowsPathKey(root) !== windowsPathKey(roots[0]))) {
    throw new Error('SystemRoot and WINDIR disagree');
  }

  const systemRoot = roots[0];
  const executable = path.win32.resolve(systemRoot, relativePath);
  const expectedPrefix = `${windowsPathKey(systemRoot)}\\`;
  if (!windowsPathKey(executable).startsWith(expectedPrefix)) {
    throw new Error('Windows system executable resolved outside SystemRoot');
  }
  if (!existsSync(executable) || !statSync(executable).isFile()) {
    throw new Error(`Required Windows system executable was not found: ${executable}`);
  }

  const canonicalRoot = windowsPathKey(realpathSync(systemRoot));
  const canonicalExecutable = windowsPathKey(realpathSync(executable));
  if (!canonicalExecutable.startsWith(`${canonicalRoot}\\`)) {
    throw new Error('Windows system executable resolves outside SystemRoot');
  }
  return executable;
}

module.exports = { resolveWindowsSystemExecutable };
