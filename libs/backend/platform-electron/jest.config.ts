export default {
  displayName: 'platform-electron',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  transformIgnorePatterns: ['node_modules/(?!(chokidar|readdirp)/)'],
  coverageDirectory: '../../../coverage/libs/backend/platform-electron',
  // `workspace-watch-host-rss-sampler.js` (Batch 15) is a plain-JS fixture
  // spawned as a real child process for RSS sampling; only ONE of its three
  // `process.platform` branches runs per CI OS, which would drag down the
  // `branches: 75` gate below for a file this project's own production code
  // never imports for its logic (`libs/frontend/core/jest.config.ts` sets the
  // same precedent for excluding one file from coverage).
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'workspace-watch-host-rss-sampler\\.js',
  ],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 75,
      functions: 90,
      lines: 95,
    },
  },
};
