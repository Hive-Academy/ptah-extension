#!/usr/bin/env node
/**
 * Fix Frontend Libraries Typecheck Configuration
 *
 * This script updates all frontend library project.json files to use Angular's
 * compiler (ngc) instead of plain TypeScript compiler (tsc) for template type checking.
 *
 * WHY THIS IS NEEDED:
 * - tsc does NOT understand Angular templates
 * - ngc performs full Angular template type checking (strictTemplates)
 * - Catches missing required inputs, incorrect bindings, etc.
 *
 * Usage:
 *   node scripts/fix-frontend-typecheck.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Frontend libraries to update
const frontendLibraries = [
  'libs/frontend/analytics',
  'libs/frontend/chat',
  'libs/frontend/core',
  'libs/frontend/dashboard',
  'libs/frontend/providers',
  'libs/frontend/session',
  'libs/frontend/shared-ui',
];

/**
 * Update typecheck target in project.json to use ngc
 */
function updateProjectJson(libraryPath) {
  const projectJsonPath = join(rootDir, libraryPath, 'project.json');

  try {
    const content = readFileSync(projectJsonPath, 'utf-8');
    const projectJson = JSON.parse(content);

    // Ensure targets object exists
    if (!projectJson.targets) {
      projectJson.targets = {};
    }

    // Check if typecheck target exists
    if (!projectJson.targets.typecheck) {
      // Add typecheck target
      projectJson.targets.typecheck = {
        executor: 'nx:run-commands',
        options: {
          command: `npx ngc --noEmit --project ${libraryPath}/tsconfig.lib.json`,
        },
      };

      // Write back to file (preserve formatting with 2 spaces)
      writeFileSync(
        projectJsonPath,
        JSON.stringify(projectJson, null, 2) + '\n',
        'utf-8'
      );

      console.log(`✅ ${libraryPath}: Added typecheck target with ngc`);
      return { added: true };
    }

    // Get current command
    const currentCommand = projectJson.targets.typecheck.options?.command;

    if (!currentCommand) {
      console.log(
        `⚠️  ${libraryPath}: No command found in typecheck target, skipping...`
      );
      return { skipped: true };
    }

    // Check if already using ngc
    if (currentCommand.includes('ngc')) {
      console.log(`✅ ${libraryPath}: Already using ngc, skipping...`);
      return { alreadyFixed: true };
    }

    // Replace tsc with ngc
    const newCommand = currentCommand.replace(/\btsc\b/, 'npx ngc');

    // Update the command
    projectJson.targets.typecheck.options.command = newCommand;

    // Write back to file (preserve formatting with 2 spaces)
    writeFileSync(
      projectJsonPath,
      JSON.stringify(projectJson, null, 2) + '\n',
      'utf-8'
    );

    console.log(`✅ ${libraryPath}: Updated typecheck target`);
    console.log(`   Old: ${currentCommand}`);
    console.log(`   New: ${newCommand}`);

    return { updated: true };
  } catch (error) {
    console.error(
      `❌ ${libraryPath}: Error updating project.json - ${error.message}`
    );
    return { error: true };
  }
}
/**
 * Main execution
 */
function main() {
  console.log('🔧 Fixing Frontend Library Typecheck Configuration\n');
  console.log(
    'Converting from tsc to ngc for Angular template type checking...\n'
  );

  const results = {
    added: 0,
    updated: 0,
    alreadyFixed: 0,
    skipped: 0,
    errors: 0,
  };

  for (const library of frontendLibraries) {
    const result = updateProjectJson(library);

    if (result.added) results.added++;
    if (result.updated) results.updated++;
    if (result.alreadyFixed) results.alreadyFixed++;
    if (result.skipped) results.skipped++;
    if (result.error) results.errors++;
  }

  console.log('\n📊 Summary:');
  console.log(`   ✅ Added: ${results.added}`);
  console.log(`   ✅ Updated: ${results.updated}`);
  console.log(`   ✅ Already fixed: ${results.alreadyFixed}`);
  console.log(`   ⚠️  Skipped: ${results.skipped}`);
  console.log(`   ❌ Errors: ${results.errors}`);

  if (results.added > 0 || results.updated > 0) {
    console.log('\n🎉 Successfully updated typecheck targets!');
    console.log('\n📝 Next steps:');
    console.log('   1. Run: npm run typecheck:all');
    console.log('   2. Fix any template errors that are now caught');
    console.log('   3. Commit the changes');
  }

  process.exit(results.errors > 0 ? 1 : 0);
}

main();
