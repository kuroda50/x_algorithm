import type { BeatEvents, World } from '../sim/types';

// Canvas の論理サイズ。表示は幅 100% に縮小される。
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export interface Renderer {
  // world を作り直したとき（起動時・リセット時）に呼ぶ。演出とエージェントの位置を初期化する。
  reset(world: World): void;
  // stepBeat の直後に、その戻り値を渡して呼ぶ。
  onBeat(world: World, events: BeatEvents): void;
  // 毎フレーム呼ぶ。beat は小数のビート位置、dt は前フレームからの秒数（一時停止中は 0）。
  draw(world: World, beat: number, dt: number): void;
  // 画面座標（clientX, clientY）にいるエージェントの id。いなければ null。
  hitTestAgent(clientX: number, clientY: number): number | null;
  setSelectedAgent(agentId: number | null): void;
}

export function createRenderer(_canvas: HTMLCanvasElement): Renderer {
  throw new Error('not implemented');
}
