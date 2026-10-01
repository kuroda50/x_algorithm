import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, FEED_KEEP, TOPICS } from './config';
import { feedDistribution } from './metrics';
import { createWorld, stepBeat } from './world';
import type { Params, World } from './types';

function run(world: World, params: Params, beats: number): void {
  for (let i = 0; i < beats; i++) stepBeat(world, params);
}

describe('決定性', () => {
  it('同じシードなら 200 ビート後も interest と feed が完全に一致する', () => {
    const w1 = createWorld(42, 12);
    const w2 = createWorld(42, 12);
    run(w1, DEFAULT_PARAMS, 200);
    run(w2, DEFAULT_PARAMS, 200);
    for (let i = 0; i < 12; i++) {
      expect(w2.agents[i].interest).toEqual(w1.agents[i].interest);
      expect(w2.agents[i].feed).toEqual(w1.agents[i].feed);
    }
  });

  it('違うシードなら一致しない', () => {
    const w1 = createWorld(42, 12);
    const w2 = createWorld(43, 12);
    run(w1, DEFAULT_PARAMS, 200);
    run(w2, DEFAULT_PARAMS, 200);
    expect(w2.agents.map((a) => a.interest)).not.toEqual(
      w1.agents.map((a) => a.interest),
    );
    expect(w2.agents.map((a) => a.feed)).not.toEqual(w1.agents.map((a) => a.feed));
  });
});

describe('学習', () => {
  it('learningRate=0 なら 200 ビート後も interest は初期値のまま', () => {
    const world = createWorld(5, 8);
    const before = world.agents.map((a) => [...a.interest]);
    run(world, { ...DEFAULT_PARAMS, learningRate: 0 }, 200);
    // 正規化で末尾の桁だけ動くので、誤差つきで比べる。
    world.agents.forEach((a, i) =>
      a.interest.forEach((v, t) => expect(v).toBeCloseTo(before[i][t], 9)),
    );
  });

  it('interest は常に合計 1 で全要素が正', () => {
    const world = createWorld(9, 12);
    run(world, DEFAULT_PARAMS, 200);
    for (const a of world.agents) {
      const sum = a.interest.reduce((s, v) => s + v, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      for (const v of a.interest) expect(v).toBeGreaterThan(0);
    }
  });
});

describe('候補の掃除', () => {
  it('world.candidates は増え続けない', () => {
    const world = createWorld(11, 12);
    run(world, DEFAULT_PARAMS, 200);
    const c200 = world.candidates.length;
    run(world, DEFAULT_PARAMS, 200);
    const c400 = world.candidates.length;
    expect(c400).toBeLessThan(c200 + 100);
  });
});

describe('フィルターバブル', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: フィードが偏り、エージェント間で分かれる`, () => {
      const world = createWorld(seed, 12);

      // フィードがたまるまでは指標を記録しない
      run(world, DEFAULT_PARAMS, 8);
      expect(world.metrics).toHaveLength(0);

      run(world, DEFAULT_PARAMS, 32);
      const m40 = world.metrics[world.metrics.length - 1];
      // 始まってすぐ偏りきっていないこと
      expect(m40.bubble).toBeLessThan(0.5);
      expect(m40.beat).toBe(40);

      run(world, DEFAULT_PARAMS, 360);
      const m400 = world.metrics[world.metrics.length - 1];
      expect(m400.beat).toBe(400);
      expect(m400.bubble).toBeGreaterThanOrEqual(m40.bubble + 0.15);
      expect(m400.similarity).toBeLessThan(m40.similarity);

      // 全員が同じ話題に収束しない
      const tops = new Set<number>();
      for (const a of world.agents) {
        const d = feedDistribution(a);
        if (!d) continue;
        tops.add(d.indexOf(Math.max(...d)));
      }
      expect(tops.size).toBeGreaterThanOrEqual(3);
    });
  }

  it('フィードは FEED_KEEP 件を超えない', () => {
    const world = createWorld(4, 6);
    run(world, DEFAULT_PARAMS, 100);
    for (const a of world.agents) {
      expect(a.feed.length).toBeLessThanOrEqual(FEED_KEEP);
      for (const item of a.feed) {
        expect(item.topic).toBeGreaterThanOrEqual(0);
        expect(item.topic).toBeLessThan(TOPICS.length);
      }
    }
  });
});

describe('既読の記録', () => {
  it('消えた投稿の id は seen に残らない（増え続けない）', () => {
    const world = createWorld(4, 12);
    run(world, DEFAULT_PARAMS, 400);
    for (const a of world.agents) {
      for (const id of a.seen) expect(world.posts.has(id)).toBe(true);
    }
  });
});
