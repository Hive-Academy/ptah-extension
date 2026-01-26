```bash
ptah_license_server  | [Nest] 926  - 01/26/2026, 1:52:33 PM     LOG Environment: development
ptah_postgres        | 2026-01-26 13:52:41.377 UTC [71] ERROR:  invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"
ptah_postgres        | 2026-01-26 13:52:41.377 UTC [71] CONTEXT:  unnamed portal parameter $1 = '...'
ptah_postgres        | 2026-01-26 13:52:41.377 UTC [71] STATEMENT:  SELECT "public"."users"."id", "public"."users"."workos_id", "public"."users"."email", "public"."users"."first_name", "public"."users"."last_name", "public"."users"."email_verified", "public"."users"."created_at", "public"."users"."updated_at" FROM "public"."users" WHERE ("public"."users"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3
ptah_license_server  | [Nest] 926  - 01/26/2026, 1:52:41 PM   ERROR [ExceptionsHandler] DriverAdapterError: invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"
ptah_license_server  |     at PrismaPgAdapter.onError (/app/node_modules/@prisma/adapter-pg/dist/index.js:693:11)
ptah_license_server  |     at PrismaPgAdapter.performIO (/app/node_modules/@prisma/adapter-pg/dist/index.js:688:12)
ptah_license_server  |     at processTicksAndRejections (node:internal/process/task_queues:95:5)
ptah_license_server  |     at PrismaPgAdapter.queryRaw (/app/node_modules/@prisma/adapter-pg/dist/index.js:608:30)
ptah_license_server  |     at /app/node_modules/@prisma/client-engine-runtime/src/tracing.ts:68:22
ptah_license_server  |     at fr (/app/node_modules/@prisma/client-engine-runtime/src/tracing.ts:56:10)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:190:26)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:217:41)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:132:29)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:276:41) {
ptah_license_server  |   cause: {
ptah_license_server  |     originalCode: '22P02',
ptah_license_server  |     originalMessage: 'invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"',
ptah_license_server  |     kind: 'postgres',
ptah_license_server  |     code: '22P02',
ptah_license_server  |     severity: 'ERROR',
ptah_license_server  |     message: 'invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"',
ptah_license_server  |     detail: undefined,
ptah_license_server  |     column: undefined,
ptah_license_server  |     hint: undefined
ptah_license_server  |   },
ptah_license_server  |   clientVersion: '7.1.0'
ptah_license_server  | }
ptah_license_server  |
ptah_postgres        | 2026-01-26 13:53:45.422 UTC [165] ERROR:  invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"
ptah_postgres        | 2026-01-26 13:53:45.422 UTC [165] CONTEXT:  unnamed portal parameter $1 = '...'
ptah_postgres        | 2026-01-26 13:53:45.422 UTC [165] STATEMENT:  SELECT "public"."users"."id", "public"."users"."workos_id", "public"."users"."email", "public"."users"."first_name", "public"."users"."last_name", "public"."users"."email_verified", "public"."users"."created_at", "public"."users"."updated_at" FROM "public"."users" WHERE ("public"."users"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3
ptah_license_server  | [Nest] 926  - 01/26/2026, 1:53:45 PM   ERROR [ExceptionsHandler] DriverAdapterError: invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"
ptah_license_server  |     at PrismaPgAdapter.onError (/app/node_modules/@prisma/adapter-pg/dist/index.js:693:11)
ptah_license_server  |     at PrismaPgAdapter.performIO (/app/node_modules/@prisma/adapter-pg/dist/index.js:688:12)
ptah_license_server  |     at processTicksAndRejections (node:internal/process/task_queues:95:5)
ptah_license_server  |     at PrismaPgAdapter.queryRaw (/app/node_modules/@prisma/adapter-pg/dist/index.js:608:30)
ptah_license_server  |     at /app/node_modules/@prisma/client-engine-runtime/src/tracing.ts:68:22
ptah_license_server  |     at fr (/app/node_modules/@prisma/client-engine-runtime/src/tracing.ts:56:10)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:190:26)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:217:41)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:132:29)
ptah_license_server  |     at e.interpretNode (/app/node_modules/@prisma/client-engine-runtime/src/interpreter/query-interpreter.ts:276:41) {
ptah_license_server  |   cause: {
ptah_license_server  |     originalCode: '22P02',
ptah_license_server  |     originalMessage: 'invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"',
ptah_license_server  |     kind: 'postgres',
ptah_license_server  |     code: '22P02',
ptah_license_server  |     severity: 'ERROR',
ptah_license_server  |     message: 'invalid input syntax for type uuid: "user_01KFTXDBX8YNNK8KPQHKR36YYZ"',
ptah_license_server  |     detail: undefined,
ptah_license_server  |     column: undefined,
ptah_license_server  |     hint: undefined
ptah_license_server  |   },
ptah_license_server  |   clientVersion: '7.1.0'
ptah_license_server  | }
ptah_license_server  |


```
