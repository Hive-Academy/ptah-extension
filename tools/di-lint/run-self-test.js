#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, 'check-injects.ts');
const result = spawnSync(
  'npx',
  ['ts-node', '--transpile-only', script, '--self-test'],
  { stdio: 'inherit', shell: true },
);

if (result.status === 1) {
  console.error(
    'di-lint self-test PASS: fixture violation detected, exit code 1 as expected',
  );
  process.exit(0);
}

if (result.status === 0) {
  console.error(
    'di-lint self-test FAIL: expected non-zero exit, got 0 (linter did not detect fixture violation)',
  );
  process.exit(1);
}

console.error(`di-lint self-test FAIL: unexpected exit code ${result.status}`);
process.exit(1);
