/**
 * Deterministic output regression test.
 *
 * Verifies that two consecutive `npm run generate` runs against unchanged
 * .vega, CSV, and layout inputs produce byte-identical output files.
 * This guards against accidental wall-clock timestamps, unstable sort
 * orders, or other non-determinism leaking into committed artifacts.
 *
 * REQUIREMENTS:
 *   - .vega snapshot present (as in CI/production)
 *   - Run from project root
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(filePath: string): string {
  const abs = resolve(projectRoot, filePath);
  if (!existsSync(abs)) return 'MISSING';
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

const OUTPUT_FILES = [
  'src/data/generated/binder-data.json',
  'public/data/binder.json',
  'data/binder-layout.json',
] as const;

describe('Deterministic generation (two consecutive runs)', () => {
  let hashesBefore: Record<string, string>;

  beforeAll(() => {
    // Record SHA256 of all output files before re-generation
    hashesBefore = {};
    for (const file of OUTPUT_FILES) {
      hashesBefore[file] = sha256(file);
    }
  });

  it('regenerates without error', () => {
    execSync('npm run generate', { cwd: projectRoot, stdio: 'pipe' });
    // If we get here, generation succeeded
    expect(true).toBe(true);
  });

  it('output files still exist after regeneration', () => {
    for (const file of OUTPUT_FILES) {
      expect(existsSync(resolve(projectRoot, file)), `${file} should exist`).toBe(true);
    }
  });

  it('all output files are byte-identical to first run (deterministic)', () => {
    for (const file of OUTPUT_FILES) {
      const hashAfter = sha256(file);
      expect(hashAfter, `${file} changed between consecutive runs — non-determinism detected`).toBe(hashesBefore[file]);
    }
  });
});
