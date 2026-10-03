// 工程の紹介（最初の 64 拍）のボールの動き。
// ボールはベルトコンベアの上を等速で運ばれ（跳ねない）、各工程の機械の手前で一列に並び、
// 1 個ずつ機械の下に進んで止まり、機械が動いて見た目が変わってから次へ進む。
// 位置は時刻の絶対値（show/tour.ts の tourTimes）だけから決める純粋な関数で、状態を持たない。
// three.js にも DOM にも依存しない。
import type { Candidate } from '../sim/types';
import { TOPICS } from '../sim/config';
import {
  TOUR_CYCLE,
  TOUR_DIVERSITY_T0,
  TOUR_DOOR_FALL,
  TOUR_DWELL_IN,
  TOUR_DWELL_OUT,
  TOUR_FALL,
  TOUR_FEED_T0,
  TOUR_FILTER_T0,
  TOUR_FLY,
  TOUR_MOVE,
  TOUR_PITCH,
  TOUR_PITCH_WIDE,
  TOUR_SCORE_T0,
  TOUR_SELECT_T0,
  TOUR_SPEED,
  TOUR_X_BELL,
  TOUR_X_DIVERSITY,
  TOUR_X_END,
  TOUR_X_LAND,
  TOUR_X_PRESS,
  TOUR_X_REJECT,
  TOUR_X_SCORE,
  TOUR_X_SCRAP,
  tourTimes,
  type TourTimes,
} from '../show/tour';
import {
  BALL_R,
  clamp01,
  DROPPED_COLOR,
  HOP_HEIGHT,
  p3,
  SIZE_BLEND,
  SQUASH_BEATS,
  TOUR_BELT_Y,
  TOUR_BIN_TOP_Y,
  TOUR_PIPE_IN_MOUTH,
  TOUR_PIPE_OUT_MOUTH,
  VANISH_BIN,
  VANISH_CATCH,
  type P3,
} from './stageLayout';
import type { BallState } from './trajectory';

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const smooth = (u: number): number => {
  const t = clamp01(u);
  return t * t * (3 - 2 * t);
};

// しぼり機の左右の板の、中心から内側の面までの距離のふだんの値
export const JAW_REST = 0.95;

// 工程の列の進み具合。H(m) = T0 + TOUR_CYCLE * m に機械が当たる工程で、
// 順番 n のボールから見た「列が何マス分進んだか」（小数）。
// 各前進は H(m) - TOUR_DWELL_IN - TOUR_MOVE に始まり、TOUR_MOVE 拍かかる。
// 列の全員が 1 周期ごとに q ずつ一斉に前へ進み、先頭の 1 個が機械の下に入る。
function adv(T0: number, n: number, t: number): number {
  let a = 0;
  for (let m = 0; m <= n; m++) {
    a += clamp01((t - (T0 + TOUR_CYCLE * m - TOUR_DWELL_IN - TOUR_MOVE)) / TOUR_MOVE);
  }
  return a;
}

// 工程の列にいるボールの x の上限。機械の手前に n+1 個分の間隔を空けて並び、
// 列が進むたびに q ずつ右へ寄る。adv = n+1 で機械の真下（x = X）に着く（着くのは H(n) - TOUR_DWELL_IN）。
const queueX = (X: number, q: number, n: number, T0: number, t: number): number =>
  X - q * (n + 1 - adv(T0, n, t));

// ベルトで運ばれる x。出発点から TOUR_SPEED で右へ進むが、行き先の列の式の x を越えない
// （列がまだ進んでいなければその末尾で待つ。列に遅れて着く場合も小さいほうを取るので x は戻らない）。
const beltLeg = (t0: number, x0: number, bound: number, t: number): number =>
  Math.min(x0 + TOUR_SPEED * (t - t0), bound);

// ベルトの上にいる間（land 以降、箱へ落ちる・発射台から飛ぶまで）の x。時刻について戻らない。
function beltX(c: Candidate, T: TourTimes, t: number): number {
  const { k, j, i } = c.tour!;
  // land → フィルタの列 → プレス
  const pressDep = T.filter + TOUR_DWELL_OUT;
  if (t < pressDep) {
    return beltLeg(
      T.land,
      TOUR_X_LAND,
      queueX(TOUR_X_PRESS, TOUR_PITCH, k, TOUR_FILTER_T0, t),
      t,
    );
  }
  if (c.dropStage === 1) {
    // プレス → 除外の扉（着いた時刻 = T.scrapDoor で扉が開く）
    return beltLeg(pressDep, TOUR_X_PRESS, TOUR_X_SCRAP, t);
  }
  // プレス → スコアリングの列 → 計測ゲート
  const scoreDep = T.score! + TOUR_DWELL_OUT;
  if (t < scoreDep) {
    return beltLeg(
      pressDep,
      TOUR_X_PRESS,
      queueX(TOUR_X_SCORE, TOUR_PITCH, j, TOUR_SCORE_T0, t),
      t,
    );
  }
  // 計測ゲート → 多様性調整の列 → しぼり機
  const divDep = T.diversity! + TOUR_DWELL_OUT;
  if (t < divDep) {
    return beltLeg(
      scoreDep,
      TOUR_X_SCORE,
      queueX(TOUR_X_DIVERSITY, TOUR_PITCH_WIDE, j, TOUR_DIVERSITY_T0, t),
      t,
    );
  }
  // しぼり機 → 選抜の扉の列 → 扉の上
  const doorDep = T.select! + TOUR_DWELL_OUT;
  if (t < doorDep) {
    return beltLeg(
      divDep,
      TOUR_X_DIVERSITY,
      queueX(TOUR_X_REJECT, TOUR_PITCH_WIDE, j, TOUR_SELECT_T0, t),
      t,
    );
  }
  if (c.dropStage === 4) return TOUR_X_REJECT;
  // 選抜の扉 → ベル（鳴るまで止まる）
  const bellDep = T.bell! + TOUR_DWELL_OUT;
  if (t < bellDep) {
    return beltLeg(doorDep, TOUR_X_REJECT, TOUR_X_BELL, t);
  }
  // ベル → 発射台の列（「機械が当たる時刻」= 飛び立つ時刻 T.launch、TOUR_DWELL_OUT は使わない）
  return beltLeg(
    bellDep,
    TOUR_X_BELL,
    queueX(TOUR_X_END, TOUR_PITCH_WIDE, i, TOUR_FEED_T0, t),
    t,
  );
}

// ボール 1 個の今の状態（trajectory.ts の ballState と同じ型・同じ約束）。
// agentPos は届く先のエージェントの円の今の位置。
export function tourBallState(c: Candidate, beat: number, agentPos: P3): BallState {
  const T = tourTimes(c);
  const mouth = c.source === 'in' ? TOUR_PIPE_IN_MOUTH : TOUR_PIPE_OUT_MOUTH;

  // 大きさ: score の時刻にスコアに応じて、diversity の時刻に多様性調整の比だけ、
  // それぞれ SIZE_BLEND 拍かけて滑らかに変わる（合奏と同じ式）。
  let scale = 1;
  if (T.score !== null) {
    const f = 0.75 + 0.65 * clamp01(c.scoreNorm);
    scale *= 1 + (f - 1) * smooth((beat - T.score) / SIZE_BLEND);
  }
  if (T.diversity !== null) {
    const f = c.score > 0 ? Math.min(1, Math.max(0.5, c.adjusted / c.score)) : 1;
    scale *= 1 + (f - 1) * smooth((beat - T.diversity) / SIZE_BLEND);
  }
  const radius = BALL_R * scale;

  // 色: 話題の色。除外・落選が確定した時刻から灰色で、× の印が付く。
  let color = TOPICS[c.topic].color;
  let crossed = false;
  if (c.dropStage === 1 && beat >= T.filter) {
    color = DROPPED_COLOR;
    crossed = true;
  }
  if (c.dropStage === 4 && T.select !== null && beat >= T.select) {
    color = DROPPED_COLOR;
    crossed = true;
  }

  // 伸び縮み: ベルトに落ちたときと、プレスに当たった直後の SQUASH_BEATS 拍だけ 1 → 0。
  let squash = 0;
  for (const t0 of [T.land, T.filter]) {
    const age = beat - t0;
    if (age >= 0 && age < SQUASH_BEATS) squash = 1 - age / SQUASH_BEATS;
  }

  const hollow = c.source === 'out';
  const state = (pos: P3, r: number, opacity: number, visible: boolean): BallState => ({
    pos,
    radius: r,
    opacity,
    color,
    squash,
    hollow,
    crossed,
    visible,
  });

  if (!Number.isFinite(beat) || beat < T.emerge) return state(mouth, 0, 0, false);

  // パイプの口からベルトへ落ちる。x は線形、y は u² で加速。最初の 0.15 拍で育つ。
  if (beat < T.land) {
    const u = clamp01((beat - T.emerge) / TOUR_FALL);
    const grow = smooth((beat - T.emerge) / 0.15);
    return state(
      p3(lerp(mouth.x, TOUR_X_LAND, u), lerp(mouth.y, TOUR_BELT_Y + radius, u * u), 0),
      radius * grow,
      1,
      true,
    );
  }

  // フィルタで除外: 扉が開いて真下の箱の口へ落ち、沈みながら消える
  if (T.scrapDoor !== null && T.scrap !== null && beat >= T.scrapDoor) {
    if (beat < T.scrap) {
      const u = clamp01((beat - T.scrapDoor) / TOUR_DOOR_FALL);
      return state(
        p3(TOUR_X_SCRAP, lerp(TOUR_BELT_Y + radius, TOUR_BIN_TOP_Y, u * u), 0),
        radius,
        1,
        true,
      );
    }
    const age = beat - T.scrap;
    const s = Math.max(0, 1 - age / VANISH_BIN);
    return state(p3(TOUR_X_SCRAP, TOUR_BIN_TOP_Y - age * 1.4, 0), radius, s, s > 0);
  }

  // 落選: 選抜の扉が開いて真下の箱の口へ落ち、沈みながら消える
  if (T.select !== null && T.reject !== null && beat >= T.select) {
    if (beat < T.reject) {
      const u = clamp01((beat - T.select) / TOUR_DOOR_FALL);
      return state(
        p3(TOUR_X_REJECT, lerp(TOUR_BELT_Y + radius, TOUR_BIN_TOP_Y, u * u), 0),
        radius,
        1,
        true,
      );
    }
    const age = beat - T.reject;
    const s = Math.max(0, 1 - age / VANISH_BIN);
    return state(p3(TOUR_X_REJECT, TOUR_BIN_TOP_Y - age * 1.4, 0), radius, s, s > 0);
  }

  // 発射台からエージェントへ放物線で飛び、受け止められて縮んで消える
  if (T.launch !== null && T.catch !== null && beat >= T.launch) {
    if (beat < T.catch) {
      const u = clamp01((beat - T.launch) / TOUR_FLY);
      const hop = HOP_HEIGHT * TOUR_FLY * TOUR_FLY * 4 * u * (1 - u);
      return state(
        p3(
          lerp(TOUR_X_END, agentPos.x, u),
          lerp(TOUR_BELT_Y + radius, agentPos.y, u) + hop,
          0,
        ),
        radius,
        1,
        true,
      );
    }
    const s = Math.max(0, 1 - (beat - T.catch) / VANISH_CATCH);
    return state(agentPos, radius * s, s, s > 0);
  }

  // ベルトの上（中心の y は常に TOUR_BELT_Y + radius）
  return state(p3(beltX(c, T, beat), TOUR_BELT_Y + radius, 0), radius, 1, true);
}

// 機械の今の状態。紹介のボール（c.tour を持つもの）の時刻からだけ決める。
export interface TourMachineState {
  press: number; // 0（上で待つ）..1（ボールに当たっている）
  pressInk: number; // 0..1。除外のボールに当たった直後に 1 → 0（ヘッドを黒くする）
  scrapDoor: number; // 0（閉）..1（開ききり）
  rejectDoor: number; // 同上
  gauge: number; // スコアの計器の高さ 0..1
  gaugeTopic: number | null; // 計器に出しているボールの話題。出していないとき null
  jawGap: number; // しぼり機の左右の板の、中心から内側の面までの距離
  bell: number; // 0..1。鳴った直後 1 → 0
  bellTopic: number | null;
  pipeIn: number; // 0..1。フォロー内のパイプからボールが出た直後 1 → 0
  pipeOut: number;
}

// 当たったあと 1 から dur 拍かけて 0 へ戻る量。当たる前は 0。
const decay = (u: number, dur: number): number => (u < 0 ? 0 : Math.max(0, 1 - u / dur));

export function tourMachines(
  candidates: readonly Candidate[],
  beat: number,
): TourMachineState {
  const m: TourMachineState = {
    press: 0,
    pressInk: 0,
    scrapDoor: 0,
    rejectDoor: 0,
    gauge: 0,
    gaugeTopic: null,
    jawGap: JAW_REST,
    bell: 0,
    bellTopic: null,
    pipeIn: 0,
    pipeOut: 0,
  };
  const origin = p3(0, 0, 0); // 半径だけ読むので位置は何でもよい
  for (const c of candidates) {
    if (!c.tour) continue;
    const T = tourTimes(c);

    // パイプから出た直後（フォロー内 / フォロー外）
    const e = decay(beat - T.emerge, 0.5);
    if (c.source === 'in') m.pipeIn = Math.max(m.pipeIn, e);
    else m.pipeOut = Math.max(m.pipeOut, e);

    // プレス: 当たる 0.25 拍前から降り始め、当たって 0.1 拍押し、0.3 拍かけて戻る
    const pdt = beat - T.filter;
    let p = 0;
    if (pdt >= -0.25 && pdt < 0) p = (pdt + 0.25) / 0.25;
    else if (pdt >= 0 && pdt < 0.1) p = 1;
    else if (pdt >= 0.1 && pdt < 0.4) p = 1 - (pdt - 0.1) / 0.3;
    m.press = Math.max(m.press, p);
    if (c.dropStage === 1) {
      // 除外のボールに当たるとヘッドが黒くなる
      m.pressInk = Math.max(m.pressInk, decay(pdt, 0.5));
      // 除外の扉: ボールが着いた瞬間に開ききり、0.7 拍かけて閉じる
      if (T.scrapDoor !== null) {
        m.scrapDoor = Math.max(m.scrapDoor, decay(beat - T.scrapDoor, 0.7));
      }
      continue;
    }

    // 計測ゲート: 0.25 拍前からスコアの高さまで伸び、0.5 拍保持して 0.3 拍で戻る。
    // スコアは低い側に寄るので、鍵盤の割り当て（show/score.ts の vibeBar）と同じ 0.6 乗で広げる
    const gdt = beat - T.score!;
    const goal = clamp01(c.scoreNorm) ** 0.6;
    let g = 0;
    if (gdt >= -0.25 && gdt < 0) g = (goal * (gdt + 0.25)) / 0.25;
    else if (gdt >= 0 && gdt < 0.5) g = goal;
    else if (gdt >= 0.5 && gdt < 0.8) g = goal * (1 - (gdt - 0.5) / 0.3);
    if (g > m.gauge) {
      m.gauge = g;
      m.gaugeTopic = c.topic;
    }

    // しぼり機: 0.25 拍前から調整前の半径まで閉じ、0.3 拍は今の半径に追従、0.3 拍かけて開く
    const ddt = beat - T.diversity!;
    let gap = JAW_REST;
    if (ddt >= -0.25 && ddt < 0.6) {
      const preR = BALL_R * (0.75 + 0.65 * clamp01(c.scoreNorm)) + 0.04;
      if (ddt < 0) gap = lerp(JAW_REST, preR, (ddt + 0.25) / 0.25);
      else if (ddt < 0.3) gap = tourBallState(c, beat, origin).radius + 0.04;
      else {
        const rEnd = tourBallState(c, T.diversity! + 0.3, origin).radius + 0.04;
        gap = lerp(rEnd, JAW_REST, (ddt - 0.3) / 0.3);
      }
      m.jawGap = Math.min(m.jawGap, gap);
    }

    if (c.dropStage === 4) {
      // 選抜の扉: 判定の瞬間に開ききり、0.7 拍かけて閉じる
      m.rejectDoor = Math.max(m.rejectDoor, decay(beat - T.select!, 0.7));
    } else {
      // ベル: 鳴った直後 1 → 0
      const b = decay(beat - T.bell!, 0.5);
      if (b > m.bell) {
        m.bell = b;
        m.bellTopic = c.topic;
      }
    }
  }
  return m;
}
