/**
 * vega-reader — Vega snapshot parsing helpers.
 *
 * Reads the .vega/ raw snapshot produced by `vegapull v1.2.3`:
 *   - packs.json (set metadata)
 *   - cards_*.json (card data arrays)
 *   - images/ (PNG files)
 *   - vega.meta.toml (pull metadata)
 *
 * Exports functions consumed by `scripts/generate.js`.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/* ─── Pre-flight ──────────────────────────────────────────── */

export function checkVegaSnapshot(projectRoot, vegaSnapshotDir) {
  const vegaPath = resolve(projectRoot, vegaSnapshotDir);
  if (!existsSync(vegaPath)) return { available: false, version: null, path: vegaPath };
  const entries = readdirSync(vegaPath).filter(e => !e.startsWith('.'));
  if (entries.length === 0) return { available: false, version: null, path: vegaPath };

  let version = null;
  const metaPath = resolve(vegaPath, 'vega.meta.toml');
  if (existsSync(metaPath)) {
    try {
      const meta = readFileSync(metaPath, 'utf-8');
      const langMatch = meta.match(/^language\s*=\s*"([^"]+)"/m);
      const startMatch = meta.match(/^pull_start\s*=\s*"([^"]+)"/m);
      const durMatch = meta.match(/^pull_duration_ms\s*=\s*(\d+)/m);
      if (langMatch && startMatch) {
        version = `vegapull v1.2.3 (${langMatch[1]}, pulled ${startMatch[1]}, ${durMatch ? durMatch[1] : '?'}ms)`;
      }
    } catch { /* non-fatal */ }
  }
  if (!version) {
    const vf = resolve(vegaPath, 'version.txt');
    if (existsSync(vf)) version = readFileSync(vf, 'utf-8').trim();
  }
  return { available: true, version, path: vegaPath };
}

/* ─── Parsing helpers ─────────────────────────────────────── */

function normalizeColor(v) {
  if (!v) return null;
  const upper = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'].includes(upper) ? upper : null;
}

function normalizeType(v) {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower.includes('leader')) return 'Leader';
  if (lower.includes('character')) return 'Character';
  if (lower.includes('event')) return 'Event';
  if (lower.includes('stage')) return 'Stage';
  return null;
}

function readJsonFile(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

/* ─── Catalog builder ─────────────────────────────────────── */

/**
 * Strip _pN / _rN suffix to get the base card code for layout dedup.
 */
function toBaseCode(id) {
  return id.replace(/_(p\d+|r\d+)$/, '');
}

/**
 * Build the canonical card catalog from the Vega snapshot.
 *
 * Returns:
 *   catalog          — Map<baseCode, CatalogEntry> for layout/sorting
 *   variantCodes     — Set<exactVegaId> for CSV validation
 *   imageAvailability — Map<baseCode, string[]> for image copy
 *   packCount, cardCount
 */
export function buildCatalogFromSnapshot(vegaPath) {
  const catalog = new Map();
  const variantCodes = new Set();
  const imageAvailability = new Map();
  const jsonDir = resolve(vegaPath, 'json');
  const imagesDir = resolve(vegaPath, 'images');

  const packsData = readJsonFile(resolve(jsonDir, 'packs.json'));
  const packCount = packsData ? Object.keys(packsData).length : 0;

  const cardFiles = [];
  if (existsSync(jsonDir)) {
    for (const entry of readdirSync(jsonDir).sort()) {
      if (/^cards_\d+\.json$/.test(entry)) cardFiles.push(resolve(jsonDir, entry));
    }
  }

  let cardCount = 0;
  const seenBase = new Set();

  for (const filePath of cardFiles) {
    const cards = readJsonFile(filePath);
    if (!Array.isArray(cards)) continue;

    for (const card of cards) {
      cardCount++;
      const exactId = card.id;
      const baseCode = toBaseCode(exactId);

      // Track every exact Vega variant ID for validation
      variantCodes.add(exactId);

      // Catalog uses base code (layout dedup)
      if (seenBase.has(baseCode)) continue;
      seenBase.add(baseCode);

      const colors = Array.isArray(card.colors) ? card.colors : [];
      const color = colors.length > 0 ? normalizeColor(colors[0]) : null;
      const cost = typeof card.cost === 'number' ? card.cost : -1;

      catalog.set(baseCode, {
        code: baseCode,
        name: card.name ?? null,
        color,
        cost,
        type: normalizeType(card.category ?? card.card_type ?? null),
        image: null,
      });

      const imgs = [];
      if (existsSync(resolve(imagesDir, `${baseCode}.png`))) imgs.push(`${baseCode}.png`);
      for (let i = 1; i <= 20; i++) {
        if (existsSync(resolve(imagesDir, `${baseCode}_p${i}.png`))) imgs.push(`${baseCode}_p${i}.png`);
        if (existsSync(resolve(imagesDir, `${baseCode}_r${i}.png`))) imgs.push(`${baseCode}_r${i}.png`);
      }
      imageAvailability.set(baseCode, imgs);
    }
  }

  return { catalog, variantCodes, imageAvailability, packCount, cardCount };
}
