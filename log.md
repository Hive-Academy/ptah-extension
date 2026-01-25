```bash
Attaching to ptah_license_server, ptah_ngrok, ptah_postgres, ptah_redis
ptah_redis | 1:C 25 Jan 2026 10:38:17.893 _oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo
ptah_redis | 1:C 25 Jan 2026 10:38:17.894 _Redis version=7.4.7, bits=64, commit=00000000, modified=0, pid=1, just started
ptah_redis | 1:C 25 Jan 2026 10:38:17.894 _Configuration loaded
ptah_redis | 1:M 25 Jan 2026 10:38:17.894 _monotonic clock: POSIX clock_gettime
ptah_redis | 1:M 25 Jan 2026 10:38:17.896_ Running mode=standalone, port=6379.
ptah_redis | 1:M 25 Jan 2026 10:38:17.897_ Server initialized
ptah_redis | 1:M 25 Jan 2026 10:38:17.899_ Reading RDB base file on AOF loading...
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ Loading RDB produced by version 7.4.7
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ RDB age 67362 seconds
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ RDB memory usage when created 0.90 Mb
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ RDB is base AOF
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ Done loading RDB, keys loaded: 0, keys expired: 0.
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ DB loaded from base file appendonly.aof.1.base.rdb: 0.002 seconds
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ DB loaded from append only file: 0.003 seconds
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ Opening AOF incr file appendonly.aof.1.incr.aof on server start
ptah_redis | 1:M 25 Jan 2026 10:38:17.900_ Ready to accept connections tcp
ptah_postgres |
ptah_postgres | PostgreSQL Database directory appears to contain a database; Skipping initialization
ptah_postgres |
ptah_postgres | 2026-01-25 10:38:18.088 UTC [1] LOG: starting PostgreSQL 16.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
ptah_postgres | 2026-01-25 10:38:18.088 UTC [1] LOG: listening on IPv4 address "0.0.0.0", port 5432
ptah_postgres | 2026-01-25 10:38:18.088 UTC [1] LOG: listening on IPv6 address "::", port 5432
ptah_postgres | 2026-01-25 10:38:18.094 UTC [1] LOG: listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
ptah_postgres | 2026-01-25 10:38:18.101 UTC [29] LOG: database system was interrupted; last known up at 2026-01-25 10:04:07 UTC
ptah_postgres | 2026-01-25 10:38:18.952 UTC [29] LOG: database system was not properly shut down; automatic recovery in progress
ptah_postgres | 2026-01-25 10:38:18.956 UTC [29] LOG: redo starts at 0/19A5158
ptah_postgres | 2026-01-25 10:38:18.956 UTC [29] LOG: invalid record length at 0/19A5190: expected at least 24, got 0
ptah_postgres | 2026-01-25 10:38:18.956 UTC [29] LOG: redo done at 0/19A5158 system usage: CPU: user: 0.00 s, system: 0.00 s, elapsed: 0.00 s
ptah_postgres | 2026-01-25 10:38:18.961 UTC [27] LOG: checkpoint starting: end-of-recovery immediate wait
ptah_postgres | 2026-01-25 10:38:18.980 UTC [27] LOG: checkpoint complete: wrote 3 buffers (0.0%); 0 WAL file(s) added, 0 removed, 0 recycled; write=0.005 s, sync=0.002 s, total=0.020 s; sync files=2, longest=0.002 s, average=0.001 s; distance=0 kB, estimate=0 kB; lsn=0/19A5190, redo lsn=0/19A5190
ptah_postgres | 2026-01-25 10:38:18.987 UTC [1] LOG: database system is ready to accept connections
ptah_license_server | Waiting for database to be ready...
ptah_license_server | Running database migrations...
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="open config file" path=/var/lib/ngrok/ngrok.yml err=nil
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="open config file" path=/var/lib/ngrok/auth-config.yml err=nil
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="FIPS 140 mode" enabled=false
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="starting web service" obj=web addr=0.0.0.0:4040 allow_hosts=[]
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="client session established" obj=tunnels.session
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="tunnel session started" obj=tunnels.session
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="started tunnel" obj=tunnels name=command_line addr=<http://license-server:3000> url=<https://c63e64d5849d.ngrok-free.app>
ptah_ngrok | t=2026-01-25T10:38:25+0000 lvl=info msg="update available" obj=updater
ptah_license_server | Loaded Prisma config from prisma.config.ts.
ptah_license_server |
ptah_license_server | Prisma schema loaded from prisma/schema.prisma
ptah_license_server | Datasource "db": PostgreSQL database "ptah_licenses", schema "public" at "postgres:5432"
ptah_license_server |
ptah_license_server | 1 migration found in prisma/migrations
ptah_license_server |
ptah_license_server |
ptah_license_server | No pending migrations to apply.
ptah_license_server | Generating Prisma Client...
ptah_license_server | Loaded Prisma config from prisma.config.ts.
ptah_license_server |
ptah_license_server | Prisma schema loaded from prisma/schema.prisma
ptah_license_server |
ptah_license_server | ✔ Generated Prisma Client (7.1.0) to ./src/generated-prisma-client in 95ms
ptah_license_server |
ptah_license_server | Starting license server in development mode...
ptah_license_server |
ptah_license_server | NX Failed to start plugin worker.
ptah_license_server |
ptah_license_server |
ptah_license_server exited with code 0
ptah_license_server | Loaded Prisma config from prisma.config.ts.
ptah_license_server |
ptah_license_server | Prisma schema loaded from prisma/schema.prisma
ptah_license_server | Datasource "db": PostgreSQL database "ptah_licenses", schema "public" at "postgres:5432"
ptah_license_server |
ptah_license_server | 1 migration found in prisma/migrations
ptah_license_server |
ptah_license_server |
ptah_license_server | No pending migrations to apply.
ptah_license_server | Generating Prisma Client...
ptah_license_server | Loaded Prisma config from prisma.config.ts.
ptah_license_server |
ptah_license_server | Prisma schema loaded from prisma/schema.prisma
ptah_license_server |
ptah_license_server | ✔ Generated Prisma Client (7.1.0) to ./src/generated-prisma-client in 92ms
ptah_license_server |
ptah_license_server | Starting license server in development mode...
ptah_license_server | [baseline-browser-mapping] The data in this module is over two months old. To ensure accurate Baseline data, please update: `npm i baseline-browser-mapping@latest -D`
ptah_license_server |
ptah_license_server | NX Running target serve for project ptah-license-server and 1 task it depends on:
ptah_license_server |
ptah_license_server |
ptah_license_server |
ptah_license_server | > nx run ptah-license-server:build
ptah_license_server |
ptah_license_server | > webpack-cli build --node-env=production
ptah_license_server |
ptah_license_server | [baseline-browser-mapping] The data in this module is over two months old. To ensure accurate Baseline data, please update: `npm i baseline-browser-mapping@latest -D`
ptah_license_server | chunk (runtime: main) main.js (main) 138 KiB [entry] [rendered]
ptah_license_server | webpack compiled successfully (58a637073eae526f)
ptah_license_server |
ptah_license_server | > nx run ptah-license-server:serve:development
ptah_license_server |
ptah_license_server | Build option outputFileName not set for ptah-license-server. Using fallback value of dist/apps/ptah-license-server/main.js.
ptah_license_server | NX Daemon is not running. Node process will not restart automatically after file changes.
ptah_license_server | > nx run ptah-license-server:build:development
ptah_license_server | > webpack-cli build --node-env=development
ptah_license_server | [baseline-browser-mapping] The data in this module is over two months old. To ensure accurate Baseline data, please update: `npm i baseline-browser-mapping@latest -D`
ptah_license_server | chunk (runtime: main) main.js (main) 138 KiB [entry] [rendered]
ptah_license_server | webpack compiled successfully (d35885e2955b7d3f)
ptah_license_server | NX Successfully ran target build for project ptah-license-server
ptah_license_server | Debugger listening on ws://localhost:9229/34f6bae4-7718-4503-b2e0-17c4f7d34371
ptah_license_server | Debugger listening on ws://localhost:9229/34f6bae4-7718-4503-b2e0-17c4f7d34371
ptah_license_server | For help, see: <https://nodejs.org/en/docs/inspector>
ptah_license_server |
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [NestFactory] Starting Nest application...
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [InstanceLoader] AppModule dependencies initialized +24ms
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [InstanceLoader] PrismaModule dependencies initialized +0ms
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [InstanceLoader] ConfigHostModule dependencies initialized +0ms
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [SendGridProvider] SendGrid mail client initialized successfully
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM ERROR [WorkOSProvider] Failed to initialize WorkOS client: Cannot read properties of undefined (reading 'default')
ptah_license_server |
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM ERROR [PaddleProvider] Failed to initialize Paddle client: Cannot read properties of undefined (reading 'default')
ptah_license_server |
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [MagicLinkService] MagicLinkService initialized with TTL: 30000ms
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [InstanceLoader] ConfigModule dependencies initialized +0ms
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [InstanceLoader] ConfigModule dependencies initialized +1ms
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM LOG [EmailService] Email service initialized with SendGrid
ptah_license_server | [Nest] 910 - 01/25/2026, 10:40:38 AM ERROR [ExceptionHandler] TypeError: Cannot read properties of undefined (reading 'default')
ptah_license_server | at InstanceWrapper.useFactory [as metatype] (/app/apps/ptah-license-server/src/app/auth/providers/workos.provider.ts:60:31)
ptah_license_server | at Injector.instantiateClass (/app/node_modules/@nestjs/core/injector/injector.js:423:55)
ptah_license_server | at callback (/app/node_modules/@nestjs/core/injector/injector.js:70:45)
ptah_license_server | at Injector.resolveConstructorParams (/app/node_modules/@nestjs/core/injector/injector.js:170:24)
ptah_license_server | at Injector.loadInstance (/app/node_modules/@nestjs/core/injector/injector.js:75:13)
ptah_license_server | at Injector.loadProvider (/app/node_modules/@nestjs/core/injector/injector.js:103:9)
ptah_license_server | at /app/node_modules/@nestjs/core/injector/instance-loader.js:56:13
ptah_license_server | at async Promise.all (index 3)
ptah_license_server | at InstanceLoader.createInstancesOfProviders (/app/node_modules/@nestjs/core/injector/instance-loader.js:55:9)
ptah_license_server | at /app/node_modules/@nestjs/core/injector/instance-loader.js:40:13
ptah_license_server |
ptah_license_server | NX Process exited with code 1, waiting for changes to restart...
```
