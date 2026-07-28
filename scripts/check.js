#!/usr/bin/env node

/**
 * check — Astro type-checking and basic integrity checks.
 *
 * Runs:
 *   1. Verify generated data file exists and is valid JSON
 *   2. Verify no obvious TS errors in src/lib (via astro check)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');

const generatedPath = resolve(projectRoot, 'src/data/generated/binder-data.json');

console.log('🔎 Running checks...\n');

// 1. Check generated data exists
console.log('  1/2: Verifying generated data...');
if (!existsSync(generatedPath)) {
  console.error('❌ Missing generated data file: src/data/generated/binder-data.json');
  console.error('   Run `npm run generate` first.');
  process.exit(1);
}

try {
  const data = JSON.parse(readFileSync(generatedPath, 'utf-8'));
  const requiredKeys = ['meta', 'catalog', 'cards', 'sheets', 'binder', 'wanted', 'sources', 'attribution'];
  for (const key of requiredKeys) {
    if (!(key in data)) {
      console.error(`❌ Generated data missing required key: "${key}"`);
      process.exit(1);
    }
  }
  console.log(`  ✔  Generated data valid (${requiredKeys.length} top-level keys present)`);
} catch (err) {
  console.error('❌ Generated data file is not valid JSON:', err.message);
  process.exit(1);
}

// 2. Run astro check
console.log('  2/2: Running Astro type check...');
try {
  execSync('npx astro check', {
    cwd: projectRoot,
    stdio: 'inherit',
    timeout: 60000,
  });
  console.log('  ✔  Astro check passed');
} catch (err) {
  console.error('❌ Astro check failed');
  process.exit(1);
}

console.log('\n✅ All checks passed.');
