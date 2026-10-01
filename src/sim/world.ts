import type { BeatEvents, Params, World } from './types';

export function createWorld(_seed: number, _agentCount: number): World {
  throw new Error('not implemented');
}

// world.beat を 1 進め、そのビートの出来事を返す。
export function stepBeat(_world: World, _params: Params): BeatEvents {
  throw new Error('not implemented');
}
