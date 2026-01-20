# Local Development License Setup

This guide explains how to generate a license key for local development to test premium features (MCP server, Ptah system prompt, workspace tools).

## Prerequisites

1. **PostgreSQL** database running locally
2. **Node.js 20+** installed
3. Ptah workspace cloned and dependencies installed (`npm install`)

## Step 1: Start the License Server

```bash
# Navigate to workspace root
cd /path/to/ptah-extension

# Set environment variables (bash/zsh)
export DATABASE_URL="postgresql://user:password@localhost:5432/ptah_licenses"
export ADMIN_API_KEY="your-dev-admin-key"
export JWT_SECRET="your-dev-jwt-secret"

# Windows PowerShell alternative
$env:DATABASE_URL = "postgresql://user:password@localhost:5432/ptah_licenses"
$env:ADMIN_API_KEY = "your-dev-admin-key"
$env:JWT_SECRET = "your-dev-jwt-secret"

# Run database migrations (first time only)
cd apps/ptah-license-server
npx prisma migrate dev

# Return to root and start the server
cd ../..
nx serve ptah-license-server
```

The server will start on `http://localhost:3000`.

## Step 2: Generate a Dev License

Use the admin API to create an `early_adopter` license without sending an email:

```bash
curl -X POST http://localhost:3000/api/v1/admin/licenses \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-dev-admin-key" \
  -d '{
    "email": "dev@localhost.local",
    "plan": "early_adopter",
    "sendEmail": false
  }'
```

### Expected Response

```json
{
  "success": true,
  "license": {
    "licenseKey": "ptah_lic_a1b2c3d4e5f6...",
    "plan": "early_adopter",
    "status": "active",
    "expiresAt": "2026-03-20T12:00:00.000Z",
    "createdAt": "2026-01-20T12:00:00.000Z"
  },
  "emailSent": false
}
```

### Request Body Parameters

| Parameter   | Type    | Required | Description                                    |
|-------------|---------|----------|------------------------------------------------|
| `email`     | string  | Yes      | Valid email format (can be fake for dev)       |
| `plan`      | string  | Yes      | `"free"` or `"early_adopter"`                  |
| `sendEmail` | boolean | No       | Set to `false` to skip email delivery          |

## Step 3: Enter License in VS Code

1. Open VS Code with the Ptah extension installed
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run command: **Ptah: Enter License Key**
4. Paste the `licenseKey` from Step 2
5. Reload the VS Code window (`Ctrl+Shift+P` -> "Reload Window")

After activation, new chat sessions will have:
- Ptah MCP server enabled (workspace tools)
- Ptah system prompt appended (tool awareness)

## Troubleshooting

### License Server URL

By default, `LicenseService` connects to `https://api.ptah.dev`. For local development, you may need to configure the extension to use your local server:

```bash
# Set environment variable before launching VS Code
export PTAH_LICENSE_SERVER_URL="http://localhost:3000"
code .
```

Or configure in VS Code settings:
```json
{
  "ptah.licenseServerUrl": "http://localhost:3000"
}
```

### License Expires

Dev licenses use the `early_adopter` plan which expires after **60 days**. When expired:

1. Generate a new license using Step 2
2. Enter the new key using Step 3

### Plan Differences

| Plan           | Expires       | Premium Features |
|----------------|---------------|------------------|
| `free`         | Never         | No               |
| `early_adopter`| 60 days       | Yes              |

Premium features include:
- Ptah MCP server (workspace tools: search, symbols, diagnostics, git info)
- Ptah system prompt (tool awareness for Claude)
- SDK-powered sessions (10x faster than CLI)

### Database Reset

If you need to reset the license database completely:

```bash
cd apps/ptah-license-server
npx prisma migrate reset
```

**Warning**: This deletes all existing licenses and recreates the schema.

### API Key Mismatch

If you see `401 Unauthorized` when calling the admin API:

1. Verify `ADMIN_API_KEY` environment variable is set on the server
2. Verify `X-API-Key` header matches the server's `ADMIN_API_KEY`
3. Restart the license server after changing environment variables

### PostgreSQL Connection Issues

If the server fails to start with database errors:

1. Verify PostgreSQL is running: `pg_isready`
2. Verify database exists: `createdb ptah_licenses` (if needed)
3. Verify `DATABASE_URL` format: `postgresql://user:password@host:port/database`
4. Run migrations again: `npx prisma migrate dev`

## Quick Reference

```bash
# Start server
nx serve ptah-license-server

# Create premium dev license
curl -X POST http://localhost:3000/api/v1/admin/licenses \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-dev-admin-key" \
  -d '{"email":"dev@localhost.local","plan":"early_adopter","sendEmail":false}'

# VS Code command to enter license
Ptah: Enter License Key
```
