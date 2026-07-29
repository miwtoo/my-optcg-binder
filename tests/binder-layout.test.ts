import { describe, expect, it } from 'vitest';
import { createInitialBinderLayout, reconcileBinderLayout, validateLayout } from '../src/lib/binder/index.js';

const catalog = [
  { code: 'L1', name: 'Leader', color: 'Red' as const, cost: 0, type: 'Leader' as const },
  { code: 'C1', name: 'Character', color: 'Red' as const, cost: 1, type: 'Character' as const },
  { code: 'C2', name: 'Character 2', color: 'Red' as const, cost: 1, type: 'Character' as const },
];

describe('stable binder layout', () => {
  it('creates three tagged reserves for every populated group', () => {
    const layout = createInitialBinderLayout(catalog);
    expect(validateLayout(layout)).toEqual([]);
    expect(layout.sheets.flatMap(s => s.pockets).filter(p => p.status === 'reserved')).toHaveLength(6);
  });

  it('fills an existing reserve without moving the prior card', () => {
    const initial = createInitialBinderLayout(catalog, ['L1', 'C1']);
    const first = reconcileBinderLayout(initial, new Map([['L1', 1], ['C1', 1]]), catalog);
    const evolved = reconcileBinderLayout(first.layout, new Map([['L1', 1], ['C1', 1], ['C2', 2]]), catalog);
    expect(evolved.locations.get('C1')).toEqual(first.locations.get('C1'));
    expect(evolved.locations.get('C2')?.slot).toBe(6);
    const c2 = evolved.layout.sheets.flatMap(s => s.pockets).find(p => p.code === 'C2');
    expect(c2?.quantity).toBe(2);
  });

  it('projects a zero quantity as vacant rather than empty', () => {
    const initial = createInitialBinderLayout(catalog, ['L1']);
    const result = reconcileBinderLayout(initial, new Map([['L1', 0]]), catalog);
    // The pocket that held L1 is now vacant with code retained for restoration
    const vacant = result.layout.sheets.flatMap(s => s.pockets).find(p => p.code === 'L1');
    expect(vacant).toBeDefined();
    expect(vacant!.status).toBe('vacant');
    expect(vacant!.quantity).toBe(0);
  });

  it('rejects an incomplete catalog for exact placement', () => {
    expect(() => createInitialBinderLayout([{ code: 'X', name: null, color: 'Red', cost: null, type: 'Character' }])).toThrow(/incomplete catalog/);
  });
});
