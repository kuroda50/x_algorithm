// ボール（Candidate）の軌道。時刻表（show/score.ts の timeline）だけから
// 今の位置・大きさ・不透明度を決める純粋な関数で、状態を持たない。
// 各 Hit の時刻にちょうど打点に居ることが、音との同期の約束。
import type { Candidate } from '../sim/types';
import { TOPICS } from '../sim/config';
import { timeline } from '../show/score';
import { clamp01, hitPoint, p3, type P3 } from './stageLayout';

export const HOP_HEIGHT = 3.0; // 1 拍の区間で跳ねたときの最高到達点
export const BALL_R = 0.34; // 基準の半径
export const TAIL_STEPS = 8; // 尾の数
export const TAIL_DT = 0.016; // 尾 1 つ分の時間差（ビート）
export const VANISH_CATCH = 0.25; // 受け止められて縮んで消えるまでのビート数
export const VANISH_BIN = 0.3; // 箱に落ちて消えるまでのビート数
export const SIZE_BLEND = 0.15; // 大きさが切り替わるまでのビート数
export const SQUASH_BEATS = 0.12; // 当たった直後に伸び縮みするビート数

export const DROPPED_COLOR = '#6b7080'; // 除外・落選したあとの色（色は話題だけに使う）

export interface BallState {
  pos: P3;
  radius: number; // 描画半径。消えていく演出で 0 まで小さくなる
  opacity: number; // 0..1
  color: string;
  squash: number; // 0..1。当たった直後は 1 に近く、横に伸びて縦に潰す
  hollow: boolean; // フォロー外のボールは輪として描く
  visible: boolean;
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const smooth = (u: number): number => {
  const t = clamp01(u);
  return t * t * (3 - 2 * t);
};

// ボール 1 個の今の状態。beat は小数のビート位置、agentPos は捕まえるエージェントの円の今の位置。
export function ballState(c: Candidate, beat: number, agentPos: P3): BallState {
  const hits = timeline(c);
  const first = hits[0];
  const base: BallState = {
    pos: hitPoint(first, c, agentPos),
    radius: 0,
    opacity: 0,
    color: TOPICS[c.topic].color,
    squash: 0,
    hollow: c.source === 'out',
    visible: false,
  };
  if (!Number.isFinite(beat) || beat < first.time) return base;

  // 大きさ: vibe の打点でスコア、bass の打点で多様性調整が効く。
  let scale = 1;
  for (const h of hits) {
    if (h.kind === 'vibe') {
      const f = 0.75 + 0.65 * clamp01(c.scoreNorm);
      scale *= 1 + (f - 1) * smooth((beat - h.time) / SIZE_BLEND);
    } else if (h.kind === 'bass') {
      const f = c.score > 0 ? Math.min(1, Math.max(0.5, c.adjusted / c.score)) : 1;
      scale *= 1 + (f - 1) * smooth((beat - h.time) / SIZE_BLEND);
    }
  }

  // 色: 話題の色。フィルタで弾かれたあと・落選したあとは灰色。
  let color = base.color;
  for (const h of hits) {
    if (h.kind === 'cymbal' && beat >= h.time) color = DROPPED_COLOR;
    if (h.kind === 'trap' && beat >= h.time) color = DROPPED_COLOR;
  }

  // 伸び縮み: launch 以外の Hit に当たった直後 SQUASH_BEATS 拍のあいだ 1 → 0。
  // Hit の間隔は最短 0.5 拍なので、同時に効くのは 1 つだけ。
  let squash = 0;
  for (const h of hits) {
    if (h.kind === 'launch') continue;
    const age = beat - h.time;
    if (age >= 0 && age < SQUASH_BEATS) squash = 1 - age / SQUASH_BEATS;
  }
  const state = (pos: P3, radius: number, opacity: number, visible: boolean): BallState => ({
    pos,
    radius,
    opacity,
    color,
    squash,
    hollow: base.hollow,
    visible,
  });

  const last = hits[hits.length - 1];
  if (beat >= last.time) {
    const age = beat - last.time;
    const P = hitPoint(last, c, agentPos);
    if (last.kind === 'catch') {
      // エージェントの円の中で縮んで消える（位置は円についていく）
      const s = Math.max(0, 1 - age / VANISH_CATCH);
      return state(P, BALL_R * scale * s, s, s > 0);
    }
    // scrap / reject: 箱の中へ沈みながら消える
    const s = Math.max(0, 1 - age / VANISH_BIN);
    return state(p3(P.x, P.y - age * 1.4, P.z), BALL_R * scale, s, s > 0);
  }

  // 今いる区間 hits[i] -> hits[i+1] を探す
  let i = 0;
  while (i < hits.length - 2 && beat >= hits[i + 1].time) i++;
  const h0 = hits[i];
  const h1 = hits[i + 1];
  const dur = h1.time - h0.time;
  const u = dur > 0 ? clamp01((beat - h0.time) / dur) : 1;
  const P0 = hitPoint(h0, c, agentPos);
  const P1 = hitPoint(h1, c, agentPos);
  // 放物線: 区間の両端でちょうど打点（u=0,1 で高さ 0）、中央で HOP_HEIGHT * dur²。
  // dur² に比例させるので、半拍の跳ねは 1/4 の高さ = 重力が一定に見える。
  const hop = HOP_HEIGHT * dur * dur * 4 * u * (1 - u);
  return state(
    p3(lerp(P0.x, P1.x, u), lerp(P0.y, P1.y, u) + hop, lerp(P0.z, P1.z, u)),
    BALL_R * scale,
    1,
    true,
  );
}
