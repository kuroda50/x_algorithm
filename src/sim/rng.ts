import type { Rng } from './types';

// シード付き乱数（mulberry32）。sim/ の乱数はすべてこれを通す。
export function createRng(_seed: number): Rng {
  throw new Error('not implemented');
}
