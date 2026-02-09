/**
 * Infra Test - Trial Reminder Cron Test Client
 *
 * TASK_2025_143: Test script for manually triggering trial expiration workflow
 *
 * This script calls the license server's admin endpoint to trigger the actual
 * TrialReminderService cron job, ensuring we test the real implementation.
 *
 * Usage:
 *   npx ts-node apps/infra-test/src/main.ts              # Trigger cron job
 *   npx ts-node apps/infra-test/src/main.ts --help       # Show help
 *
 * Environment Variables:
 *   LICENSE_SERVER_URL - URL of the license server (default: http://localhost:3000)
 *   ADMIN_SECRET - Admin secret for authentication (required)
 *
 * Server Setup:
 *   The license server must be running with ADMIN_SECRET configured in its .env
 */

// Load environment variables
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: 'apps/ptah-license-server/.env' });
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env' });

// Parse command line arguments
const args = process.argv.slice(2);

/**
 * Display usage information
 */
function showUsage(): void {
  console.log(`
Trial Reminder Cron Test Client

This script triggers the actual TrialReminderService cron job in the license server,
testing the real implementation including:
- Finding expired trials
- Downgrading users to Community plan
- Recording trial reminders
- Sending emails

Usage:
  npx ts-node apps/infra-test/src/main.ts [options]

Options:
  --help                 Show this help message
  --url=<url>            Override LICENSE_SERVER_URL (default: http://localhost:3000)
  --secret=<secret>      Override ADMIN_SECRET

Environment Variables:
  LICENSE_SERVER_URL     Base URL of the license server
  ADMIN_SECRET           Admin secret for authentication (required)

Examples:
  # Trigger cron job (uses env vars)
  npx ts-node apps/infra-test/src/main.ts

  # Override URL
  npx ts-node apps/infra-test/src/main.ts --url=http://localhost:3001

Prerequisites:
  1. License server must be running:
     nx serve ptah-license-server

  2. ADMIN_SECRET must be set in the license server's .env:
     echo "ADMIN_SECRET=my-test-secret" >> apps/ptah-license-server/.env

  3. Set ADMIN_SECRET for this script (same value as above)
`);
}

// Show help if requested
if (args.includes('--help')) {
  showUsage();
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Trial Reminder Cron Test Client');
  console.log('='.repeat(60));
  console.log('');

  // Get configuration
  const urlArg = args.find((arg) => arg.startsWith('--url='));
  const secretArg = args.find((arg) => arg.startsWith('--secret='));

  const baseUrl =
    urlArg?.split('=')[1] ||
    process.env['LICENSE_SERVER_URL'] ||
    'http://localhost:3000';

  const adminSecret = secretArg?.split('=')[1] || process.env['ADMIN_SECRET'];

  if (!adminSecret) {
    console.error('❌ ERROR: ADMIN_SECRET is not set!');
    console.error('');
    console.error(
      '   Set ADMIN_SECRET in your environment or use --secret=<value>'
    );
    console.error('');
    console.error('   Example:');
    console.error(
      '     ADMIN_SECRET=my-test-secret npx ts-node apps/infra-test/src/main.ts'
    );
    console.error('');
    process.exit(1);
  }

  const endpoint = `${baseUrl}/admin/trial-reminder/trigger`;
  console.log(`Server URL: ${baseUrl}`);
  console.log(`Endpoint: POST ${endpoint}`);
  console.log('');

  try {
    console.log('🚀 Triggering trial reminder cron job...');
    console.log('');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': adminSecret,
      },
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log('✅ Cron job executed successfully!');
      console.log('');
      console.log(`Message: ${data.message}`);
    } else if (response.status === 401) {
      console.error('❌ Authentication failed!');
      console.error('');
      console.error(
        '   Check that ADMIN_SECRET matches the license server configuration.'
      );
      console.error(`   Response: ${data.message || 'Unauthorized'}`);
      process.exit(1);
    } else {
      console.error('❌ Cron job failed!');
      console.error('');
      console.error(`   Status: ${response.status}`);
      console.error(`   Message: ${data.message || JSON.stringify(data)}`);
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.error('❌ Connection refused!');
      console.error('');
      console.error(`   Cannot connect to ${baseUrl}`);
      console.error('');
      console.error('   Make sure the license server is running:');
      console.error('     nx serve ptah-license-server');
    } else {
      console.error('❌ Request failed!');
      console.error('');
      console.error(
        `   Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    process.exit(1);
  }

  console.log('');
  console.log('─'.repeat(60));
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Check license server logs for detailed execution output');
  console.log('  2. Verify database changes in Prisma Studio:');
  console.log('     npm run prisma:studio');
  console.log(
    '  3. Check if downgraded users appear in extension with Community plan'
  );
  console.log('');
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
