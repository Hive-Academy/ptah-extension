# Batch 12 fix round 1

- Changed `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.spec.ts:11-17`: typed the mirror stub as `jest.Mocked<Pick<UserLayerMirrorService, 'mirrorAll'>>` and passed it to the constructor with `as never`. The spec uses LF line endings.
- Pattern followed: `libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.spec.ts:42-65` defines a narrow dependency stub and casts it at service construction (`:60-65`).
- Checks were not run, as instructed.