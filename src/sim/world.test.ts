import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, FEED_KEEP, TOPICS } from './config';
import { feedDistribution } from './metrics';
import { createWorld, stepBeat } from './world';
import type { Candidate, Params, World } from './types';

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

describe('フィード要求', () => {
  it('各ビートで要求するエージェントはちょうど 1 体で、agents.length ビートで一巡する', () => {
    const world = createWorld(1, 6);
    const seen = new Set<number>();
    for (let i = 0; i < world.agents.length; i++) {
      const events = stepBeat(world, DEFAULT_PARAMS);
      // このビートに要求したのは 1 体だけ
      expect(events.spawned.length).toBeGreaterThan(0);
      const who = new Set(events.spawned.map((c) => c.agentId));
      expect(who.size).toBe(1);
      expect(events.spawned[0].agentId).toBe(world.beat % world.agents.length);
      seen.add(events.spawned[0].agentId);
    }
    expect(seen.size).toBe(world.agents.length);
  });

  it('request=false のビートはフィード要求を行わない（ほかの処理は動く）', () => {
    const world = createWorld(1, 6);
    const quiet = stepBeat(world, DEFAULT_PARAMS, false);
    expect(quiet.spawned).toHaveLength(0);
    const postsBefore = world.stats.posts;
    expect(postsBefore).toBeGreaterThan(0); // 投稿の生成は止まらない
    const next = stepBeat(world, DEFAULT_PARAMS);
    expect(next.spawned.length).toBeGreaterThan(0);
  });

  it('request に数値を渡すとその id のエージェント 1 体が要求する（拍との対応は見ない）', () => {
    const world = createWorld(1, 6);
    for (let i = 0; i < 3; i++) {
      const events = stepBeat(world, DEFAULT_PARAMS, 2);
      expect(events.spawned.length).toBeGreaterThan(0);
      expect(new Set(events.spawned.map((c) => c.agentId))).toEqual(new Set([2]));
    }
  });

  it('request の数値が範囲外なら要求しない', () => {
    const world = createWorld(1, 6);
    expect(stepBeat(world, DEFAULT_PARAMS, 6).spawned).toHaveLength(0);
    expect(stepBeat(world, DEFAULT_PARAMS, -1).spawned).toHaveLength(0);
  });
});

describe('doneBeat', () => {
  function bareCand(world: World, over: Partial<Candidate>): Candidate {
    return {
      id: world.nextCandidateId++,
      agentId: 0,
      postId: -1,
      topic: 0,
      authorId: 0,
      source: 'in',
      startBeat: 0,
      slot: 0,
      pLike: 0,
      pReply: 0,
      pRepost: 0,
      score: 1,
      scoreNorm: 0.5,
      adjusted: 1,
      rank: 0,
      dropStage: null,
      dropReason: null,
      ...over,
    };
  }

  it('doneBeat を付けた候補はその拍に delivered / dropped に入る', () => {
    const world = createWorld(7, 8);
    const ok = bareCand(world, { dropStage: null, doneBeat: 10 });
    const ng = bareCand(world, { dropStage: 4, dropReason: 'rank', doneBeat: 7 });
    const out = bareCand(world, { dropStage: 1, dropReason: 'bad', doneBeat: 5 });
    world.candidates.push(ok, ng, out);
    let deliveredAt = -1;
    const droppedAt: number[] = [];
    for (let i = 0; i < 12; i++) {
      const events = stepBeat(world, DEFAULT_PARAMS, false);
      if (events.delivered.some((d) => d.candidate === ok)) deliveredAt = events.beat;
      for (const c of events.dropped) {
        if (c === ng || c === out) droppedAt.push(events.beat);
      }
    }
    expect(deliveredAt).toBe(10);
    expect(droppedAt).toEqual([5, 7]); // out が 5、ng が 7
  });

  it('doneBeat がない候補は startBeat から決まる（今までどおり）', () => {
    const world = createWorld(7, 8);
    const c = bareCand(world, { dropStage: null });
    world.candidates.push(c);
    let deliveredAt = -1;
    for (let i = 0; i < 8; i++) {
      const events = stepBeat(world, DEFAULT_PARAMS, false);
      if (events.delivered.some((d) => d.candidate === c)) deliveredAt = events.beat;
    }
    expect(deliveredAt).toBe(5); // startBeat 0 + PIPELINE_BEATS 5
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
      // このテストは毎拍フィード要求する。届く件数がベルトの約 20 倍なので、
      // 1 回の効きを強くした分（config の LEARN_*）を戻して確かめる
      const params = { ...DEFAULT_PARAMS, learningRate: DEFAULT_PARAMS.learningRate / 12 };

      // フィードがたまるまでは指標を記録しない（比べられるエージェントが 2 体そろうまで）
      run(world, params, 6);
      expect(world.metrics).toHaveLength(0);

      run(world, params, 34);
      const m40 = world.metrics[world.metrics.length - 1];
      // 始まってすぐ偏りきっていないこと
      expect(m40.bubble).toBeLessThan(0.5);
      expect(m40.beat).toBe(40);

      run(world, params, 360);
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
