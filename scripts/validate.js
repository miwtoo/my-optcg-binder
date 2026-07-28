#!/usr/bin/env node

/**
 * validate — CSV/data integrity and manifest consistency.
 *
 * Reads and validates all source CSV files, checking:
 * - File exists and is parseable
 * - All card codes are known Vega catalog IDs
 * - No duplicate card-code rows (except Sabo `,51` total row)
 * - Quantities are positive integers
 * - Wanted entries have valid targets
 *
 * Exits with 0 on success, 1 on any validation error.
 */

import { resolve } from 'node:path';
import { validateAll } from '../src/lib/validate/index.js';
import { formatErrors, summarizeErrors } from '../src/lib/validate/errors.js';

const projectRoot = resolve(import.meta.dirname, '..');

console.log('🔍 Validating source data...\n');

const result = validateAll(projectRoot);

if (result.errors.length > 0) {
  console.error(formatErrors(result.errors));
  console.error(`\n❌ ${summarizeErrors(result.errors)}`);
  process.exit(1);
}

console.log(`  Collection: ${result.collection.length} card codes`);
console.log(`  Sabo deck:  ${result.saboDeck.length} card codes`);
console.log(`  Luffy deck: ${result.luffyDeck.length} card codes`);
console.log(`  Wanted:     ${result.wanted.length} entries`);
console.log(`\n✅ All source data valid.`);
process.exit(0);
