import { METRICS_MIN_FEED, TOPICS } from './config';
import type { Agent, MetricsPoint, World } from './types';

// フィード（直近 FEED_KEEP 件）の話題の分布。合計 1。フィードが空なら null。
export function feedDistribution(agent: Agent): number[] | null {
  if (agent.feed.length === 0) return null;
  const d = new Array<number>(TOPICS.length).fill(0);
  for (const item of agent.feed) d[item.topic]++;
  return d.map((n) => n / agent.feed.length);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export function computeMetrics(world: World): MetricsPoint {
  const dists: number[][] = [];
  for (const agent of world.agents) {
    // 件数が少ないうちは分布が偶然で偏って見えるので、ある程度たまってから数える。
    if (agent.feed.length < METRICS_MIN_FEED) continue;
    const d = feedDistribution(agent);
    if (d) dists.push(d);
  }
  let bubble = 0;
  let similarity = 1;
  if (dists.length > 0) {
    const lnT = Math.log(TOPICS.length);
    let sum = 0;
    for (const d of dists) {
      let h = 0;
      for (const p of d) if (p > 0) h -= p * Math.log(p);
      sum += 1 - h / lnT;
    }
    bubble = sum / dists.length;
    if (dists.length >= 2) {
      let s = 0;
      let n = 0;
      for (let i = 0; i < dists.length; i++) {
        for (let j = i + 1; j < dists.length; j++) {
          s += cosine(dists[i], dists[j]);
          n++;
        }
      }
      similarity = s / n;
    }
  }
  return { beat: world.beat, bubble, similarity };
}
