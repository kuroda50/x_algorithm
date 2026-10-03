import { describe, expect, it } from 'vitest';
import type { Candidate } from '../sim/types';
import {
  assignFlow,
  assignTour,
  FLOW_BATCH_BEATS,
  TOUR_DOOR_FALL,
  TOUR_X_BELL,
  TOUR_X_DIVERSITY,
  TOUR_X_END,
  TOUR_X_PRESS,
  TOUR_X_REJECT,
  TOUR_X_SCORE,
  TOUR_X_SCRAP,
  tourTimes,
} from '../show/tour';
import { TOUR_BELT_Y, TOUR_PIPE_IN_MOUTH, type P3 } from './stageLayout';
import { JAW_REST, tourBallState, tourMachines } from './tourMotion';
import type { BallState } from './trajectory';

const AGENT: P3 = { x: 22, y: 8.5, z: 0 };
const STEP = 0.05;

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: 0,
    agentId: 0,
    postId: 0,
    topic: 0,
    authorId: 0,
    source: 'in',
    startBeat: 4,
    slot: 0,
    pLike: 0,
    pReply: 0,
    pRepost: 0,
    score: 5,
    scoreNorm: 0.5,
    adjusted: 4,
    rank: 0,
    dropStage: null,
    dropReason: null,
    ...over,
  };
}

// in 4 個（slot 0..3）・out 4 個（slot 0..3）の 1 回分。drops: in0..in3, out0..out3 の順。
function batch(drops: (1 | 4 | null)[]): Candidate[] {
  const list: Candidate[] = [];
  let id = 0;
  for (const source of ['in', 'out'] as const) {
    for (let slot = 0; slot < 4; slot++) {
      list.push(
        cand({
          id: id * 10 + slot,
          agentId: id,
          source,
          slot,
          topic: id % 5,
          dropStage: drops[id] ?? null,
        }),
      );
      id++;
    }
  }
  assignTour(list);
  return list;
}

// 同じ 1 回分を流し続ける方式（base 付き）で流す。spawnBeat はフィード要求があった拍。
function flowBatch(drops: (1 | 4 | null)[], spawnBeat: number): Candidate[] {
  const list: Candidate[] = [];
  let id = 0;
  for (const source of ['in', 'out'] as const) {
    for (let slot = 0; slot < 4; slot++) {
      list.push(
        cand({
          id: id * 10 + slot,
          agentId: id,
          source,
          slot,
          topic: id % 5,
          dropStage: drops[id] ?? null,
        }),
      );
      id++;
    }
  }
  assignFlow(list, spawnBeat);
  return list;
}

const lastBeat = (c: Candidate) => {
  const T = tourTimes(c);
  return c.dropStage === 1 ? T.scrap! : c.dropStage === 4 ? T.reject! : T.catch!;
};

// ベルトの上に乗っている状態か（箱への落下・発射の放物線は除く）
const onBelt = (s: BallState) =>
  s.visible && Math.abs(s.pos.y - (TOUR_BELT_Y + s.radius)) < 1e-6;

// 届くのは選抜の上位 3 個まで（4 個以上だと発射台の列がベルの手前まで伸びる）
const mixed = () => batch([1, null, 4, null, 4, 1, null, 4]);
// 全員フィルタ通過（届く 3 個は k の最後尾。j - i が最大の配置）
const allPass = () => batch([4, 4, 4, null, 4, 4, null, null]);

describe('tourBallState', () => {
  it('emerge 前は見えない。land まではパイプからベルトへ落ちる', () => {
    const b = mixed();
    const c = b[0];
    const T = tourTimes(c);
    expect(tourBallState(c, T.emerge - 0.01, AGENT).visible).toBe(false);
    const mid = tourBallState(c, (T.emerge + T.land) / 2, AGENT);
    expect(mid.visible).toBe(true);
    expect(mid.pos.y).toBeLessThan(TOUR_PIPE_IN_MOUTH.y + 1);
    expect(mid.pos.y).toBeGreaterThan(TOUR_BELT_Y + mid.radius);
    const landed = tourBallState(c, T.land, AGENT);
    expect(landed.pos.x).toBeCloseTo(-15, 6);
    expect(landed.pos.y).toBeCloseTo(TOUR_BELT_Y + landed.radius, 6);
  });

  it('ベルトの上にいる間、x が時刻について戻らない', () => {
    for (const c of mixed()) {
      const T = tourTimes(c);
      let prev = -Infinity;
      for (let t = T.land; t <= lastBeat(c); t += STEP) {
        const s = tourBallState(c, t, AGENT);
        if (!onBelt(s)) continue;
        expect(s.pos.x).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = s.pos.x;
      }
    }
  });

  it('各工程で、機械が当たる時刻にボールはその機械の x にいる', () => {
    for (const c of allPass()) {
      const T = tourTimes(c);
      const at = (t: number) => tourBallState(c, t, AGENT);
      expect(at(T.filter).pos.x).toBeCloseTo(TOUR_X_PRESS, 6);
      expect(at(T.score!).pos.x).toBeCloseTo(TOUR_X_SCORE, 6);
      expect(at(T.diversity!).pos.x).toBeCloseTo(TOUR_X_DIVERSITY, 6);
      expect(at(T.select!).pos.x).toBeCloseTo(TOUR_X_REJECT, 6);
      if (c.dropStage === null) {
        expect(at(T.bell!).pos.x).toBeCloseTo(TOUR_X_BELL, 6);
        expect(at(T.launch!).pos.x).toBeCloseTo(TOUR_X_END, 6);
      }
    }
    // フィルタで落ちるボールは、扉が開く時刻に扉の中心にいる
    for (const c of batch([1, 1, null, null, null, null, null, null])) {
      if (c.dropStage !== 1) continue;
      const T = tourTimes(c);
      expect(tourBallState(c, T.scrapDoor!, AGENT).pos.x).toBeCloseTo(TOUR_X_SCRAP, 6);
    }
  });

  it('全員フィルタ通過の回でも、ベルト上の 2 個の中心の距離が半径の和の 0.9 倍を下回らない', () => {
    const b = allPass();
    const t0 = Math.min(...b.map((c) => tourTimes(c).land));
    const t1 = Math.max(...b.map(lastBeat));
    for (let t = t0; t <= t1; t += STEP) {
      const ss = b.map((c) => tourBallState(c, t, AGENT));
      for (let a = 0; a < ss.length; a++) {
        if (!onBelt(ss[a])) continue;
        for (let d = a + 1; d < ss.length; d++) {
          if (!onBelt(ss[d])) continue;
          const gap = Math.hypot(ss[a].pos.x - ss[d].pos.x, ss[a].pos.y - ss[d].pos.y);
          expect(gap).toBeGreaterThanOrEqual(0.9 * (ss[a].radius + ss[d].radius) - 1e-9);
        }
      }
    }
  });

  it('除外・落選・通過のどれでも NaN が出ない', () => {
    for (const c of mixed()) {
      const T = tourTimes(c);
      for (let t = T.emerge - 0.5; t <= lastBeat(c) + 0.6; t += 0.037) {
        const s = tourBallState(c, t, AGENT);
        expect(Number.isFinite(s.pos.x)).toBe(true);
        expect(Number.isFinite(s.pos.y)).toBe(true);
        expect(Number.isFinite(s.radius)).toBe(true);
        expect(Number.isFinite(s.opacity)).toBe(true);
      }
    }
  });
});

describe('tourBallState（流し続ける方式）', () => {
  it('各工程で、機械が当たる時刻にボールはその機械の x にいる', () => {
    for (const c of flowBatch([1, null, 4, null, 4, 1, null, null], 70)) {
      const T = tourTimes(c);
      const at = (t: number) => tourBallState(c, t, AGENT);
      expect(at(T.filter).pos.x).toBeCloseTo(TOUR_X_PRESS, 6);
      if (c.dropStage === 1) {
        expect(at(T.scrapDoor!).pos.x).toBeCloseTo(TOUR_X_SCRAP, 6);
      } else {
        expect(at(T.score!).pos.x).toBeCloseTo(TOUR_X_SCORE, 6);
        expect(at(T.diversity!).pos.x).toBeCloseTo(TOUR_X_DIVERSITY, 6);
        expect(at(T.select!).pos.x).toBeCloseTo(TOUR_X_REJECT, 6);
      }
      if (c.dropStage === null) {
        expect(at(T.bell!).pos.x).toBeCloseTo(TOUR_X_BELL, 6);
        expect(at(T.launch!).pos.x).toBeCloseTo(TOUR_X_END, 6);
      }
    }
  });

  it('ベルトの上にいる間、x が時刻について戻らない', () => {
    for (const c of flowBatch([1, null, 4, null, 4, 1, null, null], 70)) {
      const T = tourTimes(c);
      let prev = -Infinity;
      for (let t = T.land; t <= lastBeat(c); t += STEP) {
        const s = tourBallState(c, t, AGENT);
        if (!onBelt(s)) continue;
        expect(s.pos.x).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = s.pos.x;
      }
    }
  });

  // 着地直後（v = t - base - 1.25 < 0 でベルトの 1 マス目に止まって待つあいだ）は、
  // 先行するボールが移動途中で 1.25 まで近づく。2 個ともベルトに乗って動き始めたあとは
  // 常に 1 マス以上（最小 2.0）離れている。
  const expectGap = (c0: Candidate, c1: Candidate): void => {
    const t0 = Math.max(tourTimes(c0).land, tourTimes(c1).land);
    const t1 = Math.min(tourTimes(c0).launch!, tourTimes(c1).launch!);
    for (let t = t0; t <= t1; t += STEP) {
      const s0 = tourBallState(c0, t, AGENT);
      const s1 = tourBallState(c1, t, AGENT);
      if (!onBelt(s0) || !onBelt(s1)) continue;
      const settled =
        t - c0.tour!.base! - 1.25 >= 0 && t - c1.tour!.base! - 1.25 >= 0;
      expect(Math.abs(s0.pos.x - s1.pos.x)).toBeGreaterThanOrEqual(settled ? 1.5 : 1.2);
    }
  };

  it('連続する 2 個（base が 1 違う）は同じ時刻に重ならない距離にいる', () => {
    const b = flowBatch([null, null, null, null, null, null, null, null], 70);
    const byBase = [...b].sort((a, z) => a.tour!.base! - z.tour!.base!);
    for (let k = 0; k + 1 < byBase.length; k++) {
      const c0 = byBase[k];
      const c1 = byBase[k + 1];
      expect(c1.tour!.base).toBe(c0.tour!.base! + 1);
      expectGap(c0, c1);
    }
  });

  it('連続する 2 回分（FLOW_BATCH_BEATS 違い）でも前後のボールが離れている', () => {
    const b1 = flowBatch([null, null, null, null, null, null, null, null], 70);
    const b2 = flowBatch(
      [null, null, null, null, null, null, null, null],
      70 + FLOW_BATCH_BEATS,
    );
    const last1 = [...b1].sort((a, z) => z.tour!.base! - a.tour!.base!)[0];
    const first2 = [...b2].sort((a, z) => a.tour!.base! - z.tour!.base!)[0];
    expectGap(last1, first2);
  });

  it('catch の時刻にエージェントの位置にいる', () => {
    for (const c of flowBatch([1, null, 4, null, 4, 1, null, null], 70)) {
      if (c.dropStage !== null) continue;
      const T = tourTimes(c);
      const s = tourBallState(c, T.catch!, AGENT);
      expect(s.pos.x).toBeCloseTo(AGENT.x, 6);
      expect(s.pos.y).toBeCloseTo(AGENT.y, 6);
    }
  });

  it('emerge 前は見えず、land の時刻にベルトの左端に着く', () => {
    const c = flowBatch([null, null, null, null, null, null, null, null], 70)[0];
    const T = tourTimes(c);
    expect(tourBallState(c, T.emerge - 0.01, AGENT).visible).toBe(false);
    const landed = tourBallState(c, T.land, AGENT);
    expect(landed.pos.x).toBeCloseTo(-15, 6);
    expect(landed.pos.y).toBeCloseTo(TOUR_BELT_Y + landed.radius, 6);
  });
});

describe('tourMachines', () => {
  it('プレスは当たる時刻に 1、直前は降りる途中、直後に戻る', () => {
    const b = batch([null, null, null, null, null, null, null, null]);
    const T = tourTimes(b[0]);
    expect(tourMachines(b, T.filter).press).toBe(1);
    expect(tourMachines(b, T.filter - 0.125).press).toBeCloseTo(0.5, 6);
    expect(tourMachines(b, T.filter - 0.26).press).toBe(0);
    expect(tourMachines(b, T.filter + 0.4).press).toBe(0);
  });

  it('pressInk は除外のボールに当たった直後だけ黒くなる', () => {
    const b = batch([1, null, null, null, null, null, null, null]);
    const T = tourTimes(b[0]); // k0 = in0（除外）
    expect(tourMachines(b, T.filter).pressInk).toBe(1);
    expect(tourMachines(b, T.filter + 0.25).pressInk).toBeCloseTo(0.5, 6);
    expect(tourMachines(b, T.filter - 0.01).pressInk).toBe(0);
  });

  it('scrapDoor は除外の扉に着く時刻に 1、0.7 拍で閉じる', () => {
    const b = batch([1, null, null, null, null, null, null, null]);
    const T = tourTimes(b[0]);
    expect(tourMachines(b, T.scrapDoor!).scrapDoor).toBe(1);
    expect(tourMachines(b, T.scrapDoor! + 0.35).scrapDoor).toBeCloseTo(0.5, 6);
    expect(tourMachines(b, T.scrapDoor! - 0.01).scrapDoor).toBe(0);
    expect(tourMachines(b, T.scrapDoor! + TOUR_DOOR_FALL + 0.3).scrapDoor).toBe(0);
  });

  it('rejectDoor は落選の判定の時刻に 1', () => {
    const b = batch([4, null, null, null, null, null, null, null]);
    const T = tourTimes(b[0]); // k0 = in0（落選）
    expect(tourMachines(b, T.select!).rejectDoor).toBe(1);
    expect(tourMachines(b, T.select! - 0.01).rejectDoor).toBe(0);
  });

  it('gauge は当たる時刻に scoreNorm の 0.6 乗の高さ、話題はそのボール', () => {
    const b = batch([null, null, null, null, null, null, null, null]);
    for (const c of b) c.scoreNorm = 0.8;
    const T = tourTimes(b[0]);
    const m = tourMachines(b, T.score!);
    expect(m.gauge).toBeCloseTo(0.8 ** 0.6, 6);
    expect(m.gaugeTopic).toBe(b[0].topic);
    expect(tourMachines(b, T.score! - 0.125).gauge).toBeCloseTo(0.8 ** 0.6 / 2, 6);
    expect(tourMachines(b, T.score! - 0.26).gauge).toBe(0);
  });

  it('jawGap は当たる前に閉じ始め、当たっている間は今の半径 + 0.04 に追従して戻る', () => {
    const b = batch([null, null, null, null, null, null, null, null]);
    const c0 = b[0];
    const T = tourTimes(c0);
    expect(tourMachines(b, T.diversity! - 0.26).jawGap).toBeCloseTo(JAW_REST, 6);
    const clamped = tourMachines(b, T.diversity! + 0.1).jawGap;
    expect(clamped).toBeCloseTo(tourBallState(c0, T.diversity! + 0.1, AGENT).radius + 0.04, 6);
    expect(clamped).toBeLessThan(JAW_REST);
    expect(tourMachines(b, T.diversity! + 0.6).jawGap).toBeCloseTo(JAW_REST, 6);
  });

  it('bell は鳴る時刻に 1 で話題を持ち、pipeIn / pipeOut は emerge で立つ', () => {
    const b = batch([null, null, null, null, null, null, null, null]);
    const inBall = b.find((c) => c.source === 'in')!;
    const outBall = b.find((c) => c.source === 'out')!;
    const Ti = tourTimes(inBall);
    const To = tourTimes(outBall);
    expect(tourMachines(b, Ti.emerge).pipeIn).toBe(1);
    expect(tourMachines(b, Ti.emerge).pipeOut).toBe(0);
    expect(tourMachines(b, To.emerge).pipeOut).toBe(1);
    const bellT = tourTimes(inBall).bell!;
    const m = tourMachines(b, bellT);
    expect(m.bell).toBe(1);
    expect(m.bellTopic).toBe(inBall.topic);
  });
});
