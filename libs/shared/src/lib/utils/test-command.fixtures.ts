export interface TestCommandFixture {
  readonly rule: string;
  readonly command: string;
  readonly matches: boolean;
}

/** Normative Req 1.2 positive and negative command examples. */
export const TEST_COMMAND_FIXTURES: readonly TestCommandFixture[] = [
  { rule: 'Quoting', command: 'echo "npm test"', matches: false },
  { rule: 'Quoting', command: 'bash -c "npm test"', matches: false },
  { rule: 'Quoting', command: 'git commit -m "fix tests"', matches: false },
  { rule: 'R1', command: 'cd libs/x && pnpm vitest run', matches: true },
  { rule: 'R1', command: 'cd tests', matches: false },
  { rule: 'R2', command: 'CI=1 npm run test:unit', matches: true },
  { rule: 'R2', command: 'time nx test chat', matches: true },
  { rule: 'R2', command: 'NODE_ENV=test node build.js', matches: false },
  { rule: 'R3', command: 'npx nx run-many -t lint,test', matches: true },
  { rule: 'R3', command: 'pnpm exec jest', matches: true },
  { rule: 'R3', command: 'npx prettier --check .', matches: false },
  { rule: 'R4 script', command: 'npm t', matches: true },
  { rule: 'R4 script', command: 'yarn run test:e2e', matches: true },
  { rule: 'R4 script', command: 'npm run build', matches: false },
  { rule: 'R4 script', command: 'npm install -D vitest', matches: false },
  { rule: 'R4 executable', command: 'nx test chat', matches: true },
  { rule: 'R4 executable', command: 'nx run chat:test:ci', matches: true },
  {
    rule: 'R4 executable',
    command: 'nx run-many --targets=lint,test',
    matches: true,
  },
  { rule: 'R4 executable', command: 'python -m pytest -q', matches: true },
  { rule: 'R4 executable', command: 'go test ./...', matches: true },
  { rule: 'R4 executable', command: 'nx build chat', matches: false },
  { rule: 'R4 executable', command: 'nx affected -t build', matches: false },
  { rule: 'R4 executable', command: 'grep -r jest src', matches: false },
  { rule: 'R4 executable', command: 'cat jest.config.ts', matches: false },
  { rule: 'R5', command: 'pnpm vitest run', matches: true },
  { rule: 'R5', command: 'yarn jest --ci', matches: true },
  { rule: 'R5', command: 'pnpm nx test chat', matches: true },
  { rule: 'R5', command: 'pnpm install', matches: false },
  { rule: 'R5', command: 'yarn add -D jest', matches: false },
  { rule: 'R5', command: 'bun run build', matches: false },
  { rule: 'R6', command: 'jest --version', matches: false },
  { rule: 'R6', command: 'pnpm vitest --help', matches: false },
];
