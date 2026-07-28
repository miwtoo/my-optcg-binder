/**
 * Error formatting helpers for CSV validation errors.
 */

import type { CSVError } from './csv-reader';

/**
 * Format a CSVError into a human-readable message.
 */
export function formatError(err: CSVError): string {
  if (err.row === 0) {
    return `ERROR [${err.file}]: ${err.reason}`;
  }
  return `ERROR [${err.file}:${err.row}]: value="${err.value}" — ${err.reason}`;
}

/**
 * Format multiple errors into a single string with newlines.
 */
export function formatErrors(errors: CSVError[]): string {
  if (errors.length === 0) return 'No errors.';
  return errors.map(formatError).join('\n');
}

/**
 * Get a short summary of errors.
 */
export function summarizeErrors(errors: CSVError[]): string {
  if (errors.length === 0) return 'All valid.';
  const byFile = new Map<string, number>();
  for (const err of errors) {
    byFile.set(err.file, (byFile.get(err.file) ?? 0) + 1);
  }
  const fileSummary = [...byFile.entries()]
    .map(([f, c]) => `${f}: ${c} error(s)`)
    .join(', ');
  return `${errors.length} error(s): ${fileSummary}`;
}
