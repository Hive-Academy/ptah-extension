#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, 'check-degradation.ts');

// Check 1: the main detector self-test. Passes only if the tool exits 1
// (fixture violations detected).
const mainResult = spawnSync(
  'npx',
  ['ts-node', '--transpile-only', script, '--self-test'],
  { stdio: 'inherit', shell: true },
);

if (mainResult.status === 0) {
  console.error(
    'degradation-audit self-test FAIL: expected non-zero exit, got 0 (detector did not flag the fixtures)',
  );
  process.exit(1);
}

if (mainResult.status !== 1) {
  console.error(
    `degradation-audit self-test FAIL: unexpected exit code ${mainResult.status}`,
  );
  process.exit(1);
}

console.error(
  'degradation-audit self-test PASS: fixture violations detected, exit code 1 as expected',
);

// Check 2 (Revision 1, style-review Serious 1): the parse-failure guard.
// `check-degradation.ts` relies on the undeclared `sourceFile.parseDiagnostics`
// field to detect malformed input; this proves the guard fires TODAY against
// a deliberately broken fixture, so a future TypeScript upgrade that drops
// the field fails THIS self-test instead of silently scoring zero violations
// in production. Exit-code convention here is inverted from Check 1: exit 2
// means the guard correctly raised a parse failure (PASS); exit 0 means it
// did not (BROKEN).
const guardResult = spawnSync(
  'npx',
  ['ts-node', '--transpile-only', script, '--self-test-parse-guard'],
  { stdio: 'inherit', shell: true },
);

if (guardResult.status === 2) {
  console.error(
    'degradation-audit parse-guard self-test PASS: malformed fixture correctly raised a parse failure',
  );
  process.exit(0);
}

if (guardResult.status === 0) {
  console.error(
    'degradation-audit parse-guard self-test FAIL: malformed fixture did NOT raise a parse failure (parseDiagnostics field may have changed shape)',
  );
  process.exit(1);
}

console.error(
  `degradation-audit parse-guard self-test FAIL: unexpected exit code ${guardResult.status}`,
);
process.exit(1);
