#!/usr/bin/env node

/**
 * Sync project.json names with package.json names
 *
 * This script finds all projects that have both package.json and project.json,
 * and updates the project.json "name" field to match the package.json "name" field.
 *
 * Usage:
 *   node scripts/sync-project-names.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message) {
  console.log(message);
}

function findProjectJsonFiles() {
  try {
    const output = execSync('git ls-files "**/project.json"', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((f) => path.resolve(process.cwd(), f));
  } catch (error) {
    console.error('Error finding project.json files:', error.message);
    return [];
  }
}

function syncProjectName(projectJsonPath, isDryRun = false) {
  const projectDir = path.dirname(projectJsonPath);
  const packageJsonPath = path.join(projectDir, 'package.json');

  log(
    `\nProcessing: ${colors.cyan}${path.relative(
      process.cwd(),
      projectJsonPath
    )}${colors.reset}`
  );

  // Check if package.json exists
  if (!fs.existsSync(packageJsonPath)) {
    log(`  ${colors.yellow}⚠${colors.reset} No package.json found, skipping`);
    return { success: false, reason: 'no-package-json' };
  }

  try {
    // Read both files
    const projectJson = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    const projectJsonName = projectJson.name;
    const packageJsonName = packageJson.name;

    log(
      `  Current project.json name: ${colors.yellow}${projectJsonName}${colors.reset}`
    );
    log(
      `  package.json name:         ${colors.cyan}${packageJsonName}${colors.reset}`
    );

    // Check if they match
    if (projectJsonName === packageJsonName) {
      log(
        `  ${colors.green}✓${colors.reset} Names already match, no change needed`
      );
      return { success: true, reason: 'already-synced' };
    }

    // Update project.json name
    projectJson.name = packageJsonName;

    if (!isDryRun) {
      fs.writeFileSync(
        projectJsonPath,
        JSON.stringify(projectJson, null, 2) + '\n'
      );
      log(
        `  ${colors.green}✓${colors.reset} Updated project.json name to: ${colors.green}${packageJsonName}${colors.reset}`
      );
    } else {
      log(
        `  ${colors.yellow}[DRY RUN]${colors.reset} Would update to: ${colors.green}${packageJsonName}${colors.reset}`
      );
    }

    return {
      success: true,
      reason: 'updated',
      oldName: projectJsonName,
      newName: packageJsonName,
    };
  } catch (error) {
    log(`  ${colors.red}✗${colors.reset} Error: ${error.message}`);
    return { success: false, reason: 'error', error: error.message };
  }
}

function main() {
  const isDryRun = process.argv.includes('--dry-run');

  log(
    `${colors.bold}╔════════════════════════════════════════════════════════════╗${colors.reset}`
  );
  log(
    `${colors.bold}║  Sync project.json names with package.json names          ║${colors.reset}`
  );
  log(
    `${colors.bold}╚════════════════════════════════════════════════════════════╝${colors.reset}`
  );

  if (isDryRun) {
    log(
      `\n${colors.yellow}Running in DRY RUN mode - no files will be modified${colors.reset}\n`
    );
  } else {
    log('');
  }

  // Find all project.json files
  const projectJsonFiles = findProjectJsonFiles();
  log(
    `Found ${colors.cyan}${projectJsonFiles.length}${colors.reset} project.json files\n`
  );

  if (projectJsonFiles.length === 0) {
    log(`${colors.yellow}No project.json files found${colors.reset}`);
    return;
  }

  // Process each project.json
  const results = {
    updated: [],
    alreadySynced: [],
    noPackageJson: [],
    errors: [],
  };

  projectJsonFiles.forEach((projectJsonPath) => {
    const result = syncProjectName(projectJsonPath, isDryRun);

    if (result.success) {
      if (result.reason === 'updated') {
        results.updated.push({ path: projectJsonPath, ...result });
      } else if (result.reason === 'already-synced') {
        results.alreadySynced.push(projectJsonPath);
      }
    } else {
      if (result.reason === 'no-package-json') {
        results.noPackageJson.push(projectJsonPath);
      } else {
        results.errors.push({ path: projectJsonPath, error: result.error });
      }
    }
  });

  // Summary
  log(
    `\n${colors.bold}============================================================${colors.reset}`
  );
  log(`${colors.bold}Summary${colors.reset}`);
  log(
    `${colors.bold}============================================================${colors.reset}`
  );
  log(`${colors.green}✓${colors.reset} Updated: ${results.updated.length}`);
  log(
    `${colors.cyan}○${colors.reset} Already synced: ${results.alreadySynced.length}`
  );
  log(
    `${colors.yellow}⚠${colors.reset} No package.json: ${results.noPackageJson.length}`
  );
  log(`${colors.red}✗${colors.reset} Errors: ${results.errors.length}`);

  if (results.updated.length > 0) {
    log(`\n${colors.bold}Updated projects:${colors.reset}`);
    results.updated.forEach(({ path: p, oldName, newName }) => {
      const relativePath = path.relative(process.cwd(), p);
      log(`  ${colors.cyan}${path.dirname(relativePath)}${colors.reset}`);
      log(`    ${oldName} → ${colors.green}${newName}${colors.reset}`);
    });
  }

  if (results.errors.length > 0) {
    log(`\n${colors.bold}${colors.red}Errors:${colors.reset}`);
    results.errors.forEach(({ path: p, error }) => {
      log(`  ${path.relative(process.cwd(), p)}: ${error}`);
    });
  }

  log('');

  if (isDryRun && results.updated.length > 0) {
    log(
      `${colors.yellow}To apply these changes, run without --dry-run:${colors.reset}`
    );
    log(`  node scripts/sync-project-names.js`);
  } else if (!isDryRun && results.updated.length > 0) {
    log(`${colors.green}✓ Sync completed successfully!${colors.reset}`);
    log('');
    log('Next steps:');
    log('  1. Run npm run typecheck:all to verify TypeScript');
    log('  2. Run npm run lint:all to verify linting');
    log('  3. Review changes with git diff');
    log(
      `  4. Commit changes: git add -A && git commit -m "fix: sync project.json names with package.json names"`
    );
  } else if (results.updated.length === 0 && results.errors.length === 0) {
    log(
      `${colors.green}✓ All project names are already in sync!${colors.reset}`
    );
  }
}

main();
