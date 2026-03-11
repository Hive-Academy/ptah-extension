#!/usr/bin/env node

/**
 * Performance Monitoring Baseline Script
 *
 * Purpose: Capture baseline performance metrics before library extraction
 * Task: TASK_FE_001 - Angular Frontend Library Extraction & Modernization
 *
 * Metrics Captured:
 * 1. Bundle size (from webpack build)
 * 2. Build time
 * 3. Test execution time
 * 4. Number of components/services
 *
 * Usage:
 *   node scripts/performance-baseline.mjs > .claude/specs/TASK_FE_001/performance-baseline.json
 */

import { execSync } from 'child_process';
import { readFileSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

/**
 * Execute command and return output
 */
function execute(command, options = {}) {
  try {
    return execSync(command, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    console.error(error.message);
    return null;
  }
}

/**
 * Get bundle size from dist directory
 */
function getBundleSize() {
  const distPath = join(rootDir, 'dist/apps/ptah-extension-webview');

  try {
    const files = readdirSync(distPath, {
      recursive: true,
      withFileTypes: true,
    });
    let totalSize = 0;
    const fileStats = [];

    for (const file of files) {
      if (file.isFile()) {
        const filePath = join(file.path || file.parentPath, file.name);
        const stats = statSync(filePath);
        totalSize += stats.size;

        fileStats.push({
          name: file.name,
          size: stats.size,
          sizeKB: (stats.size / 1024).toFixed(2),
        });
      }
    }

    return {
      totalBytes: totalSize,
      totalKB: (totalSize / 1024).toFixed(2),
      totalMB: (totalSize / (1024 * 1024)).toFixed(2),
      files: fileStats.length,
      largestFiles: fileStats
        .sort((a, b) => b.size - a.size)
        .slice(0, 10)
        .map((f) => ({ name: f.name, sizeKB: f.sizeKB })),
    };
  } catch (error) {
    console.error('Failed to calculate bundle size:', error.message);
    return null;
  }
}

/**
 * Count components and services
 */
function countComponentsAndServices() {
  const appDir = join(rootDir, 'apps/ptah-extension-webview/src/app');

  try {
    const componentFiles = execSync(
      `find "${appDir}" -type f -name "*.component.ts" | wc -l`,
      { encoding: 'utf-8', shell: '/bin/bash' }
    ).trim();

    const serviceFiles = execSync(
      `find "${appDir}" -type f -name "*.service.ts" | wc -l`,
      { encoding: 'utf-8', shell: '/bin/bash' }
    ).trim();

    return {
      components: parseInt(componentFiles, 10),
      services: parseInt(serviceFiles, 10),
    };
  } catch (error) {
    console.error('Failed to count files:', error.message);
    return { components: 0, services: 0 };
  }
}

/**
 * Measure build time
 */
function measureBuildTime() {
  console.error('Building webview to measure build time...');
  const startTime = Date.now();

  const result = execute('npm run build:webview', { silent: true });

  if (!result) {
    return null;
  }

  const endTime = Date.now();
  const buildTimeMs = endTime - startTime;

  return {
    milliseconds: buildTimeMs,
    seconds: (buildTimeMs / 1000).toFixed(2),
    minutes: (buildTimeMs / 60000).toFixed(2),
  };
}

/**
 * Measure test execution time
 */
function measureTestTime() {
  console.error('Running tests to measure test execution time...');
  const startTime = Date.now();

  const result = execute('npm run test:webview -- --passWithNoTests', {
    silent: true,
  });

  if (!result) {
    return null;
  }

  const endTime = Date.now();
  const testTimeMs = endTime - startTime;

  return {
    milliseconds: testTimeMs,
    seconds: (testTimeMs / 1000).toFixed(2),
    minutes: (testTimeMs / 60000).toFixed(2),
  };
}

/**
 * Get Angular-specific metrics
 */
function getAngularMetrics() {
  const appDir = join(rootDir, 'apps/ptah-extension-webview/src/app');

  try {
    // Count signal usage
    const signalUsage = execSync(`grep -r "signal<" "${appDir}" | wc -l`, {
      encoding: 'utf-8',
      shell: '/bin/bash',
    }).trim();

    // Count decorator usage
    const inputDecorators = execSync(`grep -r "@Input(" "${appDir}" | wc -l`, {
      encoding: 'utf-8',
      shell: '/bin/bash',
    }).trim();

    const outputDecorators = execSync(
      `grep -r "@Output(" "${appDir}" | wc -l`,
      { encoding: 'utf-8', shell: '/bin/bash' }
    ).trim();

    // Count structural directives
    const ngIfUsage = execSync(`grep -r "\\*ngIf" "${appDir}" | wc -l`, {
      encoding: 'utf-8',
      shell: '/bin/bash',
    }).trim();

    const ngForUsage = execSync(`grep -r "\\*ngFor" "${appDir}" | wc -l`, {
      encoding: 'utf-8',
      shell: '/bin/bash',
    }).trim();

    // Count OnPush usage
    const onPushUsage = execSync(
      `grep -r "ChangeDetectionStrategy.OnPush" "${appDir}" | wc -l`,
      { encoding: 'utf-8', shell: '/bin/bash' }
    ).trim();

    return {
      signals: parseInt(signalUsage, 10),
      inputDecorators: parseInt(inputDecorators, 10),
      outputDecorators: parseInt(outputDecorators, 10),
      ngIfDirectives: parseInt(ngIfUsage, 10),
      ngForDirectives: parseInt(ngForUsage, 10),
      onPushComponents: parseInt(onPushUsage, 10),
    };
  } catch (error) {
    console.error('Failed to get Angular metrics:', error.message);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  console.error('=== PERFORMANCE BASELINE CAPTURE ===');
  console.error('Task: TASK_FE_001');
  console.error('Date:', new Date().toISOString());
  console.error('');

  const baseline = {
    metadata: {
      taskId: 'TASK_FE_001',
      captureDate: new Date().toISOString(),
      description: 'Baseline performance metrics before library extraction',
    },
    codeMetrics: countComponentsAndServices(),
    angularMetrics: getAngularMetrics(),
    buildTime: measureBuildTime(),
    bundleSize: getBundleSize(),
    testTime: measureTestTime(),
  };

  console.error('');
  console.error('=== BASELINE CAPTURE COMPLETE ===');
  console.error('');

  // Output JSON to stdout
  console.log(JSON.stringify(baseline, null, 2));
}

main().catch((error) => {
  console.error('Failed to capture baseline:', error);
  process.exit(1);
});
