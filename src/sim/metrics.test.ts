import { describe, expect, it } from 'vitest';
import { METRICS_MIN_FEED, TOPICS } from './config';
import { computeMetrics, feedDistribution } from './metrics';
import { createWorld } from './world';
import type { FeedItem } from './types';

let feedSeq = 0;
function mkFeedItem(topic: number): FeedItem {
  return {
    postId: feedSeq++,
    topic,
    authorId: 0,
    source: 'in',
    score: 0,
    deliveredBeat: 0,
    reactions: { like: false, reply: false, repost: false },
  };
}

// 話題ごとの件数の配列からフィードを作る。
function mkFeed(counts: number[]): FeedItem[] {
  const feed: FeedItem[] = [];
  counts.forEach((n, t) => {
    for (let i = 0; i < n; i++) feed.push(mkFeedItem(t));
  });
  return feed;
}

describe('feedDistribution', () => {
  it('フィードが空なら null', () => {
    const world = createWorld(1, 2);
    expect(feedDistribution(world.agents[0])).toBeNull();
  });

  it('話題の分布で合計 1', () => {
    const world = createWorld(1, 2);
    world.agents[0].feed = mkFeed([2, 1, 0, 1, 0]);
    const d = feedDistribution(world.agents[0])!;
    expect(d).toHaveLength(TOPICS.length);
    expect(d[0]).toBeCloseTo(0.5, 10);
    expect(d.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
  });
});

describe('computeMetrics', () => {
  it('均等な分布なら bubble はほぼ 0', () => {
    const world = createWorld(1, 3);
    for (const a of world.agents) a.feed = mkFeed([4, 4, 4, 4, 4]);
    const m = computeMetrics(world);
    expect(m.bubble).toBeCloseTo(0, 10);
  });

  it('1 つの話題だけなら bubble = 1', () => {
    const world = createWorld(1, 3);
    for (const a of world.agents) a.feed = mkFeed([20, 0, 0, 0, 0]);
    const m = computeMetrics(world);
    expect(m.bubble).toBe(1);
  });

  it('同じ分布同士なら similarity = 1', () => {
    const world = createWorld(1, 3);
    for (const a of world.agents) a.feed = mkFeed([10, 5, 5, 0, 0]);
    const m = computeMetrics(world);
    expect(m.similarity).toBeCloseTo(1, 10);
  });

  it('フィードが空のエージェントは除いて計算する。全員空なら bubble=0 similarity=1', () => {
    const world = createWorld(1, 4);
    const m = computeMetrics(world);
    expect(m.bubble).toBe(0);
    expect(m.similarity).toBe(1);

    world.agents[0].feed = mkFeed([20, 0, 0, 0, 0]);
    world.agents[1].feed = mkFeed([0, 0, 0, 0, 20]);
    const m2 = computeMetrics(world);
    expect(m2.bubble).toBe(1);
    expect(m2.similarity).toBeCloseTo(0, 10);
  });

  it('件数が METRICS_MIN_FEED に満たないフィードは数えない', () => {
    const world = createWorld(1, 2);
    world.agents[0].feed = mkFeed([METRICS_MIN_FEED - 1, 0, 0, 0, 0]);
    expect(computeMetrics(world).bubble).toBe(0);
    world.agents[0].feed = mkFeed([METRICS_MIN_FEED, 0, 0, 0, 0]);
    expect(computeMetrics(world).bubble).toBe(1);
  });
});
