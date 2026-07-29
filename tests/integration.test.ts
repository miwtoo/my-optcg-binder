import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedPath = resolve(projectRoot, 'src/data/generated/binder-data.json');
const publicPath = resolve(projectRoot, 'public/data/binder.json');
const binderLayoutPath = resolve(projectRoot, 'data/binder-layout.json');
const buildOutputDir = resolve(projectRoot, 'dist');
const buildDataPath = resolve(buildOutputDir, 'data/binder.json');

const REQUIRED_CONTRACT_KEYS = ['meta', 'catalog', 'cards', 'sheets', 'binder', 'wanted', 'sources', 'attribution'];

function validateBinderDataContract(data: any, label: string): void {
  // All 8 required top-level keys
  for (const key of REQUIRED_CONTRACT_KEYS) {
    expect(data, `${label}: missing key "${key}"`).toHaveProperty(key);
  }

  // meta
  expect(data.meta, `${label}: meta`).toHaveProperty('generated');
  expect(data.meta, `${label}: meta`).toHaveProperty('generator');
  expect(data.meta, `${label}: meta`).toHaveProperty('catalogSource');
  expect(data.meta, `${label}: meta`).toHaveProperty('totalCards');
  expect(data.meta, `${label}: meta`).toHaveProperty('totalSheets');
  expect(data.meta, `${label}: meta`).toHaveProperty('dataProvenance');
  expect(typeof data.meta.generated).toBe('string');
  expect(data.meta.totalCards).toBeGreaterThan(0);
  expect(data.meta.totalSheets).toBeGreaterThan(0);

  // catalog
  expect(Array.isArray(data.catalog), `${label}: catalog array`).toBe(true);
  expect(data.catalog.length, `${label}: catalog length`).toBeGreaterThan(0);
  for (const entry of data.catalog) {
    expect(entry).toHaveProperty('code');
    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('color');
    expect(entry).toHaveProperty('cost');
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('image');
    expect(typeof entry.code).toBe('string');
    expect(entry.code).toMatch(/^[A-Z]+-?\d+(-\d+)?$/);
  }

  // cards
  expect(Array.isArray(data.cards), `${label}: cards array`).toBe(true);
  expect(data.cards.length, `${label}: cards length`).toBeGreaterThan(0);
  for (const card of data.cards) {
    expect(card).toHaveProperty('code');
    expect(card).toHaveProperty('owned');
    expect(card).toHaveProperty('binderQuantity');
    expect(card).toHaveProperty('deckAllocations');
    expect(Array.isArray(card.deckAllocations)).toBe(true);
    expect(card.owned).toBeGreaterThan(0);
    expect(card.binderQuantity).toBeGreaterThanOrEqual(0);
  }

  // sheets — discriminated slot states
  expect(Array.isArray(data.sheets), `${label}: sheets array`).toBe(true);
  expect(data.sheets.length, `${label}: sheets length`).toBeGreaterThan(0);
  for (const sheet of data.sheets) {
    expect(sheet).toHaveProperty('sheet');
    expect(sheet).toHaveProperty('side');
    expect(['Front', 'Back']).toContain(sheet.side);
    expect(sheet).toHaveProperty('slots');
    expect(Array.isArray(sheet.slots)).toBe(true);
    expect(sheet.slots).toHaveLength(9);
    const validStatuses = ['card', 'reserved', 'vacant', 'empty'];
    for (const slot of sheet.slots) {
      expect(validStatuses).toContain(slot.status);
      if (slot.status === 'card') {
        expect(slot).toHaveProperty('code');
        expect(slot).toHaveProperty('quantity');
        expect(typeof slot.code).toBe('string');
        expect(slot.quantity).toBeGreaterThan(0);
      }
    }
  }

  // binder summary
  expect(data.binder, `${label}: binder`).toHaveProperty('totalPossessedCards');
  expect(data.binder, `${label}: binder`).toHaveProperty('totalUniqueCodes');
  expect(data.binder, `${label}: binder`).toHaveProperty('totalSheets');
  expect(data.binder, `${label}: binder`).toHaveProperty('totalDeckCards');
  expect(data.binder, `${label}: binder`).toHaveProperty('totalBinderCards');
  expect(data.binder, `${label}: binder`).toHaveProperty('reservedSlots');
  expect(data.binder, `${label}: binder`).toHaveProperty('overflowSheets');
  expect(data.binder.totalUniqueCodes, `${label}: binder/cards count`).toBe(data.cards.length);
  expect(data.binder.totalSheets, `${label}: binder/sheets count`).toBe(data.sheets.length / 2);

  // wanted
  expect(Array.isArray(data.wanted), `${label}: wanted array`).toBe(true);
  for (const entry of data.wanted) {
    expect(entry).toHaveProperty('code');
    expect(entry).toHaveProperty('amount');
    expect(entry).toHaveProperty('target');
    expect(typeof entry.code).toBe('string');
    expect(entry.amount).toBeGreaterThan(0);
    expect(typeof entry.target).toBe('string');
    expect(entry.target.length).toBeGreaterThan(0);
  }

  // sources
  expect(data.sources, `${label}: sources`).toHaveProperty('generated');
  expect(data.sources, `${label}: sources`).toHaveProperty('files');
  expect(typeof data.sources.generated).toBe('string');
  const fileNames = Object.keys(data.sources.files);
  expect(fileNames.length, `${label}: source files`).toBeGreaterThanOrEqual(3);
  expect(fileNames.some(f => f.includes('All'))).toBe(true);
  expect(fileNames.some(f => f.includes('Sabo'))).toBe(true);
  expect(fileNames.some(f => f.includes('Lufy'))).toBe(true);

  // attribution
  expect(data.attribution, `${label}: attribution`).toHaveProperty('copyright');
  expect(data.attribution, `${label}: attribution`).toHaveProperty('disclaimer');
  expect(data.attribution, `${label}: attribution`).toHaveProperty('dataSource');
  expect(data.attribution, `${label}: attribution`).toHaveProperty('dataSourceUrl');
  expect(data.attribution, `${label}: attribution`).toHaveProperty('toolUsed');
  expect(data.attribution.copyright).toContain('Bandai');
  expect(data.attribution.disclaimer).toContain('Not affiliated');

  // binder location references
  const cardsWithLoc = data.cards.filter((c: any) => c.binderLocation !== null);
  for (const card of cardsWithLoc) {
    expect(card.binderLocation, `${label}: location`).toHaveProperty('sheet');
    expect(card.binderLocation, `${label}: location`).toHaveProperty('side');
    expect(card.binderLocation, `${label}: location`).toHaveProperty('slot');
    expect(card.binderLocation.sheet).toBeGreaterThanOrEqual(1);
    expect(['Front', 'Back']).toContain(card.binderLocation.side);
    expect(card.binderLocation.slot).toBeGreaterThanOrEqual(1);
    expect(card.binderLocation.slot).toBeLessThanOrEqual(9);
  }

  // deck allocations
  for (const card of data.cards) {
    for (const alloc of card.deckAllocations) {
      expect(typeof alloc.deck).toBe('string');
      expect(typeof alloc.quantity).toBe('number');
      expect(alloc.quantity).toBeGreaterThan(0);
    }
  }
}

describe('Generated Data Contract — src/data/generated/binder-data.json', () => {
  let data: any;

  beforeAll(() => {
    expect(existsSync(generatedPath), 'src/data/generated/binder-data.json must exist').toBe(true);
    data = JSON.parse(readFileSync(generatedPath, 'utf-8'));
  });

  it('validates against the full BinderData schema (8 top-level keys, all sub-fields)', () => {
    validateBinderDataContract(data, 'src/data/generated/binder-data.json');
  });

  it('data provenance marks this as a Vega snapshot source (not heuristic fixture)', () => {
    expect(data.meta.catalogSource).toBe('Vega');
    expect(data.meta.dataProvenance.toLowerCase()).not.toContain('fixture');
    expect(data.meta.dataProvenance.toLowerCase()).toContain('vega snapshot');
  });

  it('catalog entries contain real card names from Vega (not null)', () => {
    for (const entry of data.catalog) {
      expect(entry.name, `catalog entry ${entry.code} should have a name`).not.toBeNull();
    }
  });

  it('catalog entries contain real colors from Vega', () => {
    for (const entry of data.catalog) {
      expect(entry.color, `catalog entry ${entry.code} should have a color`).not.toBeNull();
    }
  });

  it('catalog entries contain real costs from Vega', () => {
    expect(data.catalog.some((entry: any) => entry.cost !== null)).toBe(true);
  });

  it('catalog entries contain real types from Vega', () => {
    for (const entry of data.catalog) {
      expect(entry.type, `catalog entry ${entry.code} should have a type`).not.toBeNull();
    }
  });

  it('catalog entries contain image paths for owned codes', () => {
    const ownedCodes = new Set(data.cards.map((card: any) => card.code));
    for (const entry of data.catalog) {
      if (ownedCodes.has(entry.code)) {
        expect(entry.image, `catalog entry ${entry.code} should have an image path`).not.toBeNull();
        expect(typeof entry.image).toBe('string');
        expect(entry.image).toMatch(/^data\/card-images\/.+\.png$/);
      }
    }
  });

  it('source manifest includes Vega JSON provenance and checksums', () => {
    const files = Object.keys(data.sources.files);
    expect(files).toContain('.vega/json/packs.json');
    expect(files.some((file: string) => file.startsWith('.vega/json/cards_'))).toBe(true);
    for (const file of files.filter((name: string) => name.startsWith('.vega/'))) {
      expect(data.sources.files[file].checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('publishes one image for every owned or wanted code', () => {
    const ownedCodes = new Set(data.cards.map((card: any) => card.code));
    const wantedCodes = new Set(data.wanted.map((entry: any) => entry.code));
    const assetDir = resolve(projectRoot, 'public/data/card-images');
    for (const code of new Set([...ownedCodes, ...wantedCodes])) {
      expect(existsSync(resolve(assetDir, `${code}.png`))).toBe(true);
    }
  });
});

describe('Public Contract — public/data/binder.json', () => {
  let data: any;

  beforeAll(() => {
    expect(existsSync(publicPath), 'public/data/binder.json must exist').toBe(true);
    data = JSON.parse(readFileSync(publicPath, 'utf-8'));
  });

  it('validates against the full BinderData schema (same 8-key contract)', () => {
    validateBinderDataContract(data, 'public/data/binder.json');
  });

  it('matches the internal src/data/generated version byte-for-byte in structure', () => {
    const internal = JSON.parse(readFileSync(generatedPath, 'utf-8'));
    expect(Object.keys(data).sort()).toEqual(Object.keys(internal).sort());
    expect(data.meta.totalCards).toBe(internal.meta.totalCards);
    expect(data.meta.totalSheets).toBe(internal.meta.totalSheets);
    expect(data.cards.length).toBe(internal.cards.length);
    expect(data.sheets.length).toBe(internal.sheets.length);
    expect(data.binder.totalPossessedCards).toBe(internal.binder.totalPossessedCards);
  });
});

describe('Generated Binder Layout — data/binder-layout.json', () => {
  it('exists and is valid JSON', () => {
    expect(existsSync(binderLayoutPath), 'data/binder-layout.json must exist').toBe(true);
    const raw = readFileSync(binderLayoutPath, 'utf-8');
    const layout = JSON.parse(raw);
    expect(layout).toHaveProperty('version');
    expect(layout.version).toBe(1);
    expect(layout).toHaveProperty('sheets');
    expect(Array.isArray(layout.sheets)).toBe(true);
    expect(layout.sheets.length).toBeGreaterThan(0);
  });

  it('every pocket has a valid discriminated status', () => {
    const layout = JSON.parse(readFileSync(binderLayoutPath, 'utf-8'));
    const validStatuses = ['reserved', 'vacant', 'empty', 'card'];
    for (const sheet of layout.sheets) {
      expect(sheet).toHaveProperty('sheetId');
      expect(sheet).toHaveProperty('sheet');
      expect(sheet).toHaveProperty('side');
      expect(['Front', 'Back']).toContain(sheet.side);
      expect(sheet).toHaveProperty('pockets');
      expect(Array.isArray(sheet.pockets)).toBe(true);
      for (const pocket of sheet.pockets) {
        expect(validStatuses).toContain(pocket.status);
        expect(pocket).toHaveProperty('sheetId');
        expect(pocket).toHaveProperty('section');
        expect(pocket).toHaveProperty('pocket');
        if (pocket.status === 'card') {
          expect(typeof pocket.code).toBe('string');
          expect(typeof pocket.quantity).toBe('number');
          expect(pocket.quantity).toBeGreaterThanOrEqual(0);
        }
        if (pocket.status === 'reserved') {
          expect(typeof pocket.tag).toBe('string');
        }
      }
    }
  });

  it('pocket positions are unique within each side', () => {
    const layout = JSON.parse(readFileSync(binderLayoutPath, 'utf-8'));
    for (const sheet of layout.sheets) {
      const seen = new Set<number>();
      for (const pocket of sheet.pockets) {
        expect(seen.has(pocket.pocket)).toBe(false);
        seen.add(pocket.pocket);
        expect(pocket.pocket).toBeGreaterThanOrEqual(1);
        expect(pocket.pocket).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe('Build Artifacts — dist/', () => {
  it('dist directory exists after build', () => {
    expect(existsSync(buildOutputDir), 'dist/ must exist — run `pnpm run build` first').toBe(true);
  });

  it('dist/index.html is present and non-empty', () => {
    const html = readFileSync(resolve(buildOutputDir, 'index.html'), 'utf-8');
    expect(html.length).toBeGreaterThan(100);
    expect(html.toLowerCase()).toContain('<!doctype html>');
  });

  it('dist/data/binder.json is present and valid BinderData', () => {
    expect(existsSync(buildDataPath), 'dist/data/binder.json must exist').toBe(true);
    const raw = readFileSync(buildDataPath, 'utf-8');
    const data = JSON.parse(raw);
    validateBinderDataContract(data, 'dist/data/binder.json');
  });

  it('dist/data/binder.json matches committed public contract', () => {
    const built = JSON.parse(readFileSync(buildDataPath, 'utf-8'));
    const published = JSON.parse(readFileSync(publicPath, 'utf-8'));
    expect(built.meta.totalCards).toBe(published.meta.totalCards);
    expect(built.cards.length).toBe(published.cards.length);
    expect(built.sheets.length).toBe(published.sheets.length);
  });

  it('dist/assets/ has at least one CSS file', () => {
    const assetsDir = resolve(buildOutputDir, 'assets');
    expect(existsSync(assetsDir), 'dist/assets/ must exist').toBe(true);
    const entries = readdirSync(assetsDir);
    const cssFiles = entries.filter((n: string) => n.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('CSV Corrections', () => {
  function assertSingleMatch(csv: string, pattern: RegExp): void {
    const matches = csv.match(pattern);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  }

  it('duplicate OP05-057 is removed (only one row exists)', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    assertSingleMatch(csv, /OP05-057/g);
  });

  it('duplicate EB01-028 is removed (only one row exists)', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    assertSingleMatch(csv, /EB01-028/g);
  });

  it('duplicate OP14-074 is removed (only one row exists)', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    assertSingleMatch(csv, /OP14-074/g);
  });

  it('EB-03-008 is corrected to EB03-008', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    expect(csv).not.toContain('EB-03-008');
    expect(csv).toContain('EB03-008');
  });

  it('EB03-52 is corrected to EB03-052', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    expect(csv).not.toContain('EB03-52,');
    expect(csv).toContain('EB03-052');
  });

  it('Want to Buy.csv exists with valid entries', () => {
    expect(existsSync(resolve(projectRoot, 'Want to Buy.csv'))).toBe(true);
    const csv = readFileSync(resolve(projectRoot, 'Want to Buy.csv'), 'utf-8');
    const lines = csv.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1); // header + data
    expect(lines[0]).toContain('code');
    expect(lines[0]).toContain('target');
  });

  it('Sabo CSV preserves the ,51 exception row', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - Sabo.csv'), 'utf-8');
    expect(csv).toContain(',51');
  });
});
