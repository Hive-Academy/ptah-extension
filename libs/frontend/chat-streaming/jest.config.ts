export default {
  displayName: 'chat-streaming',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/chat-streaming',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
  // Wave-1 ratchet baseline (TASK_2026_105 G2 Phase 3). Targets the moved
  // streaming write-path bundle: streaming-handler, message-finalization,
  // event-deduplication, batched-update, permission-handler,
  // session-manager, execution-tree-builder, background-agent.store,
  // agent-monitor.store. Will be ratcheted up as more streaming surface
  // migrates here in later phases.
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60,
    },
  },
};
