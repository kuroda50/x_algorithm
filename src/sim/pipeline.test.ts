import { describe, expect, it } from 'vitest';
import {
  CANDIDATES_IN,
  CANDIDATES_OUT,
  DEFAULT_PARAMS,
  POST_MAX_AGE,
  SELECT_K,
  TOPICS,
} from './config';
import {
  applyDiversity,
  checkFilter,
  maxScore,
  runPipeline,
  scorePost,
  selectTopK,
} from './pipeline';
import { createWorld } from './world';
import type { Candidate, Params, Post } from './types';

let postSeq = 100000;
function mkPost(p: Partial<Post>): Post {
  return {
    id: postSeq++,
    authorId: 0,
    topic: 0,
    quality: 0.5,
    bad: false,
    createdBeat: 0,
    engagements: 0,
    ...p,
  };
}

let candSeq = 0;
function mkCand(p: Partial<Candidate>): Candidate {
  return {
    id: candSeq++,
    agentId: 0,
    postId: 0,
    topic: 0,
    authorId: 0,
    source: 'in',
    startBeat: 0,
    slot: 0,
    pLike: 0,
    pReply: 0,
    pRepost: 0,
    score: 0,
    scoreNorm: 0,
    adjusted: 0,
    rank: -1,
    dropStage: null,
    dropReason: null,
    ...p,
  };
}

const uniform = TOPICS.map(() => 1 / TOPICS.length);

describe('フィルタ', () => {
  it('bad の投稿は除外される', () => {
    expect(checkFilter(mkPost({ bad: true }), 0)).toBe('bad');
    expect(checkFilter(mkPost({ bad: false }), 0)).toBeNull();
  });

  it('POST_MAX_AGE より古い投稿は除外される', () => {
    expect(checkFilter(mkPost({ createdBeat: 0 }), POST_MAX_AGE)).toBeNull();
    expect(checkFilter(mkPost({ createdBeat: 0 }), POST_MAX_AGE + 1)).toBe('old');
  });

  it('runPipeline で bad の投稿は dropStage=1 になる', () => {
    const world = createWorld(7, 4);
    const agent = world.agents[0];
    const author = world.authors[0];
    agent.follows.add(author.id);
    const bad = mkPost({ authorId: author.id, bad: true, createdBeat: world.beat });
    world.posts.clear(); // 候補取得で必ず選ばれるよう、この投稿だけにする
    world.posts.set(bad.id, bad);
    const cands = runPipeline(world, agent, DEFAULT_PARAMS);
    const c = cands.find((x) => x.postId === bad.id);
    expect(c?.dropStage).toBe(1);
    expect(c?.dropReason).toBe('bad');
    expect(c?.score).toBe(0);
    // フィルタで落ちた投稿は既読扱いになり、次の要求では候補にならない
    expect(agent.seen.has(bad.id)).toBe(true);
    world.candidates = [];
    expect(runPipeline(world, agent, DEFAULT_PARAMS)).toHaveLength(0);
  });

  it('フォロー内は、新しい投稿の中から興味に近い話題が選ばれる', () => {
    const world = createWorld(7, 4);
    const agent = world.agents[0];
    agent.interest = [0.96, 0.01, 0.01, 0.01, 0.01];
    const author = world.authors[0];
    agent.follows = new Set([author.id]);
    world.posts.clear();
    for (let i = 0; i < CANDIDATES_IN; i++) {
      const p = mkPost({ authorId: author.id, topic: 0, createdBeat: world.beat });
      world.posts.set(p.id, p);
    }
    // 後から来た（より新しい）別の話題の投稿があっても、興味に近い話題が優先される
    for (let i = 0; i < CANDIDATES_IN; i++) {
      const p = mkPost({ authorId: author.id, topic: 1, createdBeat: world.beat });
      world.posts.set(p.id, p);
    }
    const cands = runPipeline(world, agent, DEFAULT_PARAMS);
    expect(cands).toHaveLength(CANDIDATES_IN);
    expect(cands.every((c) => c.source === 'in' && c.topic === 0)).toBe(true);
  });
});

describe('スコアリング', () => {
  it('wReply だけ上げると pReply の高い候補のスコアが相対的に上がる', () => {
    const likeOnly: Params = { ...DEFAULT_PARAMS, wLike: 1, wReply: 0, wRepost: 0 };
    const withReply: Params = { ...likeOnly, wReply: 10 };
    const hi = scorePost(uniform, 0, 0.9, likeOnly);
    const lo = scorePost(uniform, 0, 0.1, likeOnly);
    const hi2 = scorePost(uniform, 0, 0.9, withReply);
    const lo2 = scorePost(uniform, 0, 0.1, withReply);
    expect(hi.pReply).toBeGreaterThan(lo.pReply);
    expect(hi2.score / lo2.score).toBeGreaterThan(hi.score / lo.score);
  });
});

describe('多様性調整', () => {
  it('同じ投稿者の 2 件目は減衰する', () => {
    const c1 = mkCand({ authorId: 1, score: 5 });
    const c2 = mkCand({ authorId: 1, score: 5 });
    applyDiversity([c1, c2], { ...DEFAULT_PARAMS, diversity: 0.5, oonFactor: 1 });
    expect(c1.adjusted).toBe(5);
    expect(c2.adjusted).toBeLessThan(c1.adjusted);
    expect(c2.adjusted).toBeCloseTo(2.5, 10);
  });

  it('diversity=0 なら同じ投稿者でも減衰しない', () => {
    const c1 = mkCand({ authorId: 1, score: 5 });
    const c2 = mkCand({ authorId: 1, score: 5 });
    applyDiversity([c1, c2], { ...DEFAULT_PARAMS, diversity: 0, oonFactor: 1 });
    expect(c1.adjusted).toBe(5);
    expect(c2.adjusted).toBe(5);
  });

  it('oonFactor はフォロー外の候補にだけ掛かる', () => {
    const inC = mkCand({ authorId: 1, source: 'in', score: 4 });
    const outC = mkCand({ authorId: 2, source: 'out', score: 4 });
    applyDiversity([inC, outC], { ...DEFAULT_PARAMS, diversity: 0, oonFactor: 0.5 });
    expect(inC.adjusted).toBe(4);
    expect(outC.adjusted).toBe(2);
  });
});

describe('選抜', () => {
  it('残るのは SELECT_K 件以下', () => {
    const cands = Array.from({ length: 8 }, (_, i) =>
      mkCand({ authorId: i, score: 8 - i, adjusted: 8 - i }),
    );
    selectTopK(cands);
    expect(cands.filter((c) => c.dropStage === null)).toHaveLength(SELECT_K);
    for (const c of cands.slice(SELECT_K)) {
      expect(c.dropStage).toBe(4);
      expect(c.dropReason).toBe('rank');
    }
  });

  it('runPipeline でも SELECT_K 件以下', () => {
    const world = createWorld(3, 4);
    const cands = runPipeline(world, world.agents[0], DEFAULT_PARAMS);
    expect(cands.length).toBeGreaterThan(0);
    expect(
      cands.filter((c) => c.dropStage === null).length,
    ).toBeLessThanOrEqual(SELECT_K);
  });
});

describe('発射位置と順位', () => {
  it('slot はフォロー内・フォロー外それぞれで 0,1,2,3 になる', () => {
    const world = createWorld(7, 4);
    const agent = world.agents[0];
    const inAuthor = world.authors[0];
    const outAuthor = world.authors.find((a) => a.id !== inAuthor.id)!;
    agent.follows = new Set([inAuthor.id]);
    world.posts.clear();
    for (let i = 0; i < CANDIDATES_IN; i++) {
      const p = mkPost({ authorId: inAuthor.id, createdBeat: world.beat });
      world.posts.set(p.id, p);
    }
    for (let i = 0; i < CANDIDATES_OUT; i++) {
      const p = mkPost({ authorId: outAuthor.id, createdBeat: world.beat });
      world.posts.set(p.id, p);
    }
    const cands = runPipeline(world, agent, DEFAULT_PARAMS);
    const slots = (source: 'in' | 'out') =>
      cands
        .filter((c) => c.source === source)
        .map((c) => c.slot)
        .sort();
    expect(slots('in')).toEqual([0, 1, 2, 3]);
    expect(slots('out')).toEqual([0, 1, 2, 3]);
  });

  it('フィルタを抜けた候補に adjusted の大きい順で rank が入る', () => {
    const cands = [
      mkCand({ dropStage: 1, dropReason: 'bad' }),
      ...Array.from({ length: 8 }, (_, i) => mkCand({ adjusted: 8 - i })),
    ];
    selectTopK(cands);
    const alive = cands.filter((c) => c.dropStage !== 1);
    const sorted = [...alive].sort((a, b) => b.adjusted - a.adjusted);
    sorted.forEach((c, i) => expect(c.rank).toBe(i));
    // 通過は rank 0..SELECT_K-1、落選は SELECT_K 以上
    for (const c of alive) {
      expect(c.dropStage).toBe(c.rank < SELECT_K ? null : 4);
    }
    // フィルタで落ちた候補は rank -1 のまま
    expect(cands[0].rank).toBe(-1);
  });

  it('scoreNorm は 0..1 に入り、フィルタ落ちは 0 で rank -1', () => {
    const world = createWorld(3, 4);
    const cands = runPipeline(world, world.agents[0], DEFAULT_PARAMS);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.scoreNorm).toBeGreaterThanOrEqual(0);
      expect(c.scoreNorm).toBeLessThanOrEqual(1);
      if (c.dropStage === 1) {
        expect(c.scoreNorm).toBe(0);
        expect(c.rank).toBe(-1);
      } else {
        expect(c.scoreNorm).toBeCloseTo(
          Math.min(1, c.score / maxScore(DEFAULT_PARAMS)),
          10,
        );
        expect(c.rank).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
