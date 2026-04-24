export default {
  displayName: 'platform-electron',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // chokidar 5 + readdirp 5 are pure ESM. Jest's default
  // `transformIgnorePatterns` excludes everything under node_modules, which
  // trips on `import { EventEmitter } from 'node:events'` when
  // `createFileWatcher` calls `require('chokidar')` at runtime. Let ts-jest
  // transform both packages so the contract suite loads them as CJS.
  transformIgnorePatterns: ['node_modules/(?!(chokidar|readdirp)/)'],
  coverageDirectory: '../../../coverage/libs/backend/platform-electron',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 92.49 / B 78.53 /
  // F 90.0 / L 93.71). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 75,
      functions: 90,
      lines: 90,
    },
  },
};
