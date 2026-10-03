import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_COUNT, DEFAULT_PARAMS } from '../sim/config';
import type { Candidate } from '../sim/types';
import { createWorld, stepBeat } from '../sim/world';
import { requesterAt, SHOW_SEED, TOUR_END_BEAT } from './director';
import {
  assignFlow,
  assignTour,
  FLOW_BATCH_BEATS,
  FLOW_FALL,
  flowRequester,
  TOUR_BELL_AFTER,
  TOUR_CYCLE,
  TOUR_DOOR_FALL,
  TOUR_DWELL_OUT,
  TOUR_EMERGE_EVERY,
  TOUR_EMERGE_T0,
  TOUR_FALL,
  TOUR_FEED_T0,
  TOUR_FILTER_T0,
  TOUR_FLY,
  TOUR_SCORE_T0,
  TOUR_SELECT_T0,
  TOUR_SPAWN_BEAT,
  TOUR_SPEED,
  TOUR_X_PRESS,
  TOUR_X_SCRAP,
  TOUR_DIVERSITY_T0,
  tourTimes,
} from './tour';

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: 0,
    agentId: 0,
    postId: 0,
    topic: 0,
    authorId: 0,
    source: 'in',
    startBeat: TOUR_SPAWN_BEAT,
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
    ...over,
  };
}

// in 4 個（slot 0..3）・out 4 個（slot 0..3）の 1 回分。
// drops の添字 0..3 が in の slot 0..3、4..7 が out の slot 0..3 の dropStage。
function batch(drops: (1 | 4 | null)[]): Candidate[] {
  const list: Candidate[] = [];
  let id = 0;
  for (const source of ['in', 'out'] as const) {
    for (let slot = 0; slot < 4; slot++) {
      list.push(cand({ id: id * 10 + slot, source, slot, dropStage: drops[id] ?? null }));
      id++;
    }
  }
  return list;
}

const ordered = (b: Candidate[]) => [...b].sort((a, c) => a.tour!.k - c.tour!.k);

describe('assignTour', () => {
  it('k は in / out を交互に、同じ source 内では slot 昇順', () => {
    const b = batch([null, null, null, null, null, null, null, null]);
    assignTour(b);
    const byK = ordered(b);
    expect(byK.map((c) => c.source)).toEqual([
      'in',
      'out',
      'in',
      'out',
      'in',
      'out',
      'in',
      'out',
    ]);
    expect(byK.map((c) => c.slot)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(byK.map((c) => c.tour!.k)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('片方が尽きたら残りを続ける', () => {
    const b = [
      cand({ id: 1, source: 'in', slot: 0 }),
      cand({ id: 2, source: 'in', slot: 1 }),
      cand({ id: 3, source: 'in', slot: 2 }),
      cand({ id: 4, source: 'out', slot: 0 }),
    ];
    assignTour(b);
    const byK = ordered(b);
    expect(byK.map((c) => c.source)).toEqual(['in', 'out', 'in', 'in']);
    expect(byK.map((c) => c.id)).toEqual([1, 4, 2, 3]);
  });

  it('j はフィルタ通過（dropStage !== 1）を k の順に、i は届くものを k の順に', () => {
    // k: 0 in0 除外, 1 out0 落選, 2 in1 届く, 3 out1 落選, 4 in2 除外, 5 out2 届く, 6 in3 届く, 7 out3 落選
    const b = batch([1, null, 1, null, 4, 4, null, 4]);
    assignTour(b);
    const byK = ordered(b);
    expect(byK.map((c) => c.dropStage)).toEqual([1, 4, null, 4, 1, null, null, 4]);
    expect(byK.map((c) => c.tour!.j)).toEqual([-1, 0, 1, 2, -1, 3, 4, 5]);
    expect(byK.map((c) => c.tour!.i)).toEqual([-1, -1, 0, -1, -1, 1, 2, -1]);
  });

  it('doneBeat は最後の出来事（scrap / reject / catch）の時刻の floor', () => {
    const b = batch([1, null, null, 4, 4, null, null, null]);
    assignTour(b);
    for (const c of b) {
      const T = tourTimes(c);
      const last =
        c.dropStage === 1 ? T.scrap! : c.dropStage === 4 ? T.reject! : T.catch!;
      expect(c.doneBeat).toBe(Math.floor(last));
    }
  });
});

describe('tourTimes', () => {
  it('除外（dropStage 1）: emerge → land → filter → scrapDoor → scrap', () => {
    const c = cand({ dropStage: 1, tour: { k: 3, j: -1, i: -1 } });
    const T = tourTimes(c);
    expect(T.emerge).toBe(TOUR_EMERGE_T0 + TOUR_EMERGE_EVERY * 3);
    expect(T.land).toBe(T.emerge + TOUR_FALL);
    expect(T.filter).toBe(TOUR_FILTER_T0 + TOUR_CYCLE * 3);
    expect(T.scrapDoor).toBe(
      T.filter + TOUR_DWELL_OUT + (TOUR_X_SCRAP - TOUR_X_PRESS) / TOUR_SPEED,
    );
    expect(T.scrap).toBe(T.scrapDoor! + TOUR_DOOR_FALL);
    const times = [T.emerge, T.land, T.filter, T.scrapDoor!, T.scrap!];
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(T.score).toBeNull();
    expect(T.bell).toBeNull();
    expect(T.catch).toBeNull();
  });

  it('落選（dropStage 4）: 〜 select → reject で終わる', () => {
    const c = cand({ dropStage: 4, tour: { k: 6, j: 4, i: -1 } });
    const T = tourTimes(c);
    expect(T.score).toBe(TOUR_SCORE_T0 + TOUR_CYCLE * 4);
    expect(T.diversity).toBe(TOUR_DIVERSITY_T0 + TOUR_CYCLE * 4);
    expect(T.select).toBe(TOUR_SELECT_T0 + TOUR_CYCLE * 4);
    expect(T.reject).toBe(T.select! + TOUR_DOOR_FALL);
    const times = [T.emerge, T.land, T.filter, T.score!, T.diversity!, T.select!, T.reject!];
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(T.bell).toBeNull();
    expect(T.launch).toBeNull();
  });

  it('通過: 〜 select → bell → launch → catch で終わる', () => {
    const c = cand({ dropStage: null, tour: { k: 5, j: 4, i: 2 } });
    const T = tourTimes(c);
    expect(T.bell).toBe(T.select! + TOUR_BELL_AFTER);
    expect(T.launch).toBe(TOUR_FEED_T0 + TOUR_CYCLE * 2);
    expect(T.catch).toBe(T.launch! + TOUR_FLY);
    const times = [
      T.emerge,
      T.land,
      T.filter,
      T.score!,
      T.diversity!,
      T.select!,
      T.bell!,
      T.launch!,
      T.catch!,
    ];
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('どの運命でも全時刻が TOUR_END_BEAT より前（8 個全員フィルタ通過の最悪ケースも）', () => {
    // 全員がフィルタを通り、届く 3 個が k の最後尾に並ぶ場合（j - i が最大になる配置）
    const b = batch([4, 4, 4, null, 4, 4, null, null]);
    assignTour(b);
    for (const c of b) {
      const T = tourTimes(c);
      const all = [
        T.emerge,
        T.land,
        T.filter,
        T.scrapDoor,
        T.scrap,
        T.score,
        T.diversity,
        T.select,
        T.reject,
        T.bell,
        T.launch,
        T.catch,
      ].filter((t): t is number => t !== null);
      for (const t of all) expect(t).toBeLessThan(TOUR_END_BEAT);
      // 時刻は起きる順に並んでいる
      for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThan(all[i - 1]);
    }
    // 届く最後の 1 個の catch がいちばん遅い出来事
    const lastEnd = Math.max(
      ...b.map((c) => {
        const T = tourTimes(c);
        return c.dropStage === 1 ? T.scrap! : c.dropStage === 4 ? T.reject! : T.catch!;
      }),
    );
    expect(lastEnd).toBeLessThan(TOUR_END_BEAT);
  });

  it('c.tour がないと throw する', () => {
    expect(() => tourTimes(cand())).toThrow();
  });
});

describe('tourTimes（流し続ける方式）', () => {
  it('通過: 機械が当たる時刻は base + マス + 1（emerge は base、land は base + FLOW_FALL）', () => {
    const b = 100;
    const c = cand({ dropStage: null, tour: { k: 0, j: 0, i: 0, base: b } });
    const T = tourTimes(c);
    expect(T.emerge).toBe(b);
    expect(T.land).toBe(b + FLOW_FALL);
    expect(T.filter).toBe(b + 4);
    expect(T.score).toBe(b + 8);
    expect(T.diversity).toBe(b + 12);
    expect(T.select).toBe(b + 16);
    expect(T.bell).toBe(b + 17);
    expect(T.launch).toBe(b + 19);
    expect(T.catch).toBe(b + 20);
    const times = [
      T.emerge,
      T.land,
      T.filter,
      T.score!,
      T.diversity!,
      T.select!,
      T.bell!,
      T.launch!,
      T.catch!,
    ];
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('除外（dropStage 1）: filter + 0.75 に扉、+ TOUR_DOOR_FALL で箱。score 以降は null', () => {
    const c = cand({ dropStage: 1, tour: { k: 0, j: -1, i: -1, base: 100 } });
    const T = tourTimes(c);
    expect(T.filter).toBe(104);
    expect(T.scrapDoor).toBe(T.filter + 0.75);
    expect(T.scrap).toBe(T.scrapDoor! + TOUR_DOOR_FALL);
    expect(T.score).toBeNull();
    expect(T.select).toBeNull();
    expect(T.bell).toBeNull();
    expect(T.launch).toBeNull();
    expect(T.catch).toBeNull();
  });

  it('落選（dropStage 4）: select + TOUR_DOOR_FALL で箱。bell/launch/catch は null', () => {
    const c = cand({ dropStage: 4, tour: { k: 0, j: 0, i: -1, base: 100 } });
    const T = tourTimes(c);
    expect(T.select).toBe(116);
    expect(T.reject).toBe(T.select! + TOUR_DOOR_FALL);
    expect(T.bell).toBeNull();
    expect(T.launch).toBeNull();
    expect(T.catch).toBeNull();
  });
});

describe('assignFlow', () => {
  it('base = spawnBeat + 1 + k。順番は assignTour と同じく in/out 交互', () => {
    const b = batch([1, null, 4, null, 4, 1, null, null]);
    assignFlow(b, 70);
    const byK = ordered(b);
    expect(byK.map((c) => c.tour!.base)).toEqual([71, 72, 73, 74, 75, 76, 77, 78]);
    expect(byK.map((c) => c.source)).toEqual([
      'in',
      'out',
      'in',
      'out',
      'in',
      'out',
      'in',
      'out',
    ]);
    expect(byK.map((c) => c.tour!.j)).toEqual([-1, 0, 1, -1, 2, 3, 4, 5]);
    expect(byK.map((c) => c.tour!.i)).toEqual([-1, -1, 0, -1, -1, 1, 2, 3]);
  });

  it('doneBeat は最後の出来事（scrap / reject / catch）の時刻の floor', () => {
    const b = batch([1, null, null, 4, 4, null, null, null]);
    assignFlow(b, 70);
    for (const c of b) {
      const T = tourTimes(c);
      const last =
        c.dropStage === 1 ? T.scrap! : c.dropStage === 4 ? T.reject! : T.catch!;
      expect(c.doneBeat).toBe(Math.floor(last));
    }
  });

  it('連続する 2 回分（spawnBeat が FLOW_BATCH_BEATS 違い）の base は重ならず 1 拍おきに続く', () => {
    const b1 = batch([null, null, null, null, null, null, null, null]);
    const b2 = batch([null, null, null, null, null, null, null, null]);
    assignFlow(b1, 70);
    assignFlow(b2, 70 + FLOW_BATCH_BEATS);
    const bases = [...b1, ...b2].map((c) => c.tour!.base!).sort((a, z) => a - z);
    for (let i = 1; i < bases.length; i++) expect(bases[i]).toBe(bases[i - 1] + 1);
  });
});

describe('flowRequester', () => {
  it('FLOW_BATCH_BEATS の倍数の拍に (n / FLOW_BATCH_BEATS) % agentCount、それ以外は null', () => {
    expect(flowRequester(0, 8)).toBe(0);
    for (let n = 1; n < FLOW_BATCH_BEATS; n++) expect(flowRequester(n, 8)).toBeNull();
    expect(flowRequester(FLOW_BATCH_BEATS, 8)).toBe(1);
    expect(flowRequester(7 * FLOW_BATCH_BEATS, 8)).toBe(7);
    expect(flowRequester(8 * FLOW_BATCH_BEATS, 8)).toBe(0); // 一巡して先頭へ
    expect(flowRequester(-1, 8)).toBeNull();
    expect(flowRequester(-FLOW_BATCH_BEATS, 8)).toBeNull();
  });
});

describe('発表用のシード', () => {
  it('SHOW_SEED で 4 拍目に出る 8 個: フィルタで落ちる 1〜2 個・届く 3 個', () => {
    const world = createWorld(SHOW_SEED, DEFAULT_AGENT_COUNT);
    let spawned: Candidate[] = [];
    while (world.beat < TOUR_SPAWN_BEAT) {
      const request = requesterAt(world.beat + 1, world.agents.length) ?? false;
      const events = stepBeat(world, DEFAULT_PARAMS, request);
      if (events.spawned.length > 0) spawned = events.spawned;
    }
    expect(spawned).toHaveLength(8);
    const filtered = spawned.filter((c) => c.dropStage === 1).length;
    const delivered = spawned.filter((c) => c.dropStage === null).length;
    expect(filtered).toBeGreaterThanOrEqual(1);
    expect(filtered).toBeLessThanOrEqual(2);
    expect(delivered).toBe(3);
  });
});
