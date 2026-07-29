import { describe, expect, it } from 'vitest';
import { resolveCardImagePath } from '../src/lib/data/image-url';

describe('resolveCardImagePath', () => {
  it('keeps the deployment base separated from relative generated image paths', () => {
    expect(resolveCardImagePath('/my-optcg-binder', 'data/card-images/OP13-004.png'))
      .toBe('/my-optcg-binder/data/card-images/OP13-004.png');
  });

  it('does not alter absolute image paths', () => {
    expect(resolveCardImagePath('/my-optcg-binder', '/assets/card.png')).toBe('/assets/card.png');
  });
});
