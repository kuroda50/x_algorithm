import type { Agent, MetricsPoint, World } from './types';

// フィード（直近 FEED_KEEP 件）の話題の分布。合計 1。フィードが空なら null。
export function feedDistribution(_agent: Agent): number[] | null {
  throw new Error('not implemented');
}

export function computeMetrics(_world: World): MetricsPoint {
  throw new Error('not implemented');
}
