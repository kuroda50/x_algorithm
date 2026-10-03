// ステージ上の楽器・箱・地区の位置と、ボールが各 Hit で触れる点。
// three.js にも DOM にも依存しない純粋なデータと関数だけを置く。
// 座標系は x が右・y が上の XY 平面（すべて z = 0）。
// ボールは左（-x）のパイプから右（+x）のエージェントの街へ進む。
import type { Hit } from '../show/score';
import type { Candidate } from '../sim/types';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export const p3 = (x: number, y: number, z: number): P3 => ({ x, y, z });

export const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));

// 決定的な疑似乱数 [0, 1)。配置のゆらぎや火花の向きに使う。
export function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// --- 発射パイプ（口の位置がボールの発射点） ---
export const PIPE_IN_MOUTH = p3(-14, 14, 0);
export const PIPE_OUT_MOUTH = p3(-14, 11, 0);

export function pipeMouth(index: number): P3 {
  return index === 0 ? PIPE_IN_MOUTH : PIPE_OUT_MOUTH;
}

// --- フィルタのドラム。添字は DRUM_PADS と同じ（kick, snare, hat, openHat, shaker）。
// 打点は円の頂点。円の中心は打点から半径ぶん下。
export const DRUM_HITS: readonly P3[] = [
  p3(-9.5, 6.5, 0), // kick
  p3(-11.6, 8.6, 0), // snare
  p3(-7.4, 8.8, 0), // hat
  p3(-12.0, 5.2, 0), // openHat
  p3(-7.2, 5.6, 0), // shaker
];
export const DRUM_RADII: readonly number[] = [1.2, 0.8, 0.6, 0.7, 0.5];

// --- 除外バー（旧シンバル）と除外箱 ---
export const CYMBAL_POS = p3(-6.0, 11.0, 0);
export const SCRAP_BIN = p3(-5.2, 0, 0);
export const BIN_SIZE = { w: 1.5, h: 1.2 };
export const SCRAP_MOUTH = p3(SCRAP_BIN.x, BIN_SIZE.h, 0);

// --- スコアリングのビブラフォン。鍵盤は右上への階段で、
// スコアが高いほど右上の高い段に当たる ---
export const VIBE_BAR_LEN = 0.72; // 鍵盤の長さ（x 方向）
export const VIBE_BAR_T = 0.22; // 鍵盤の厚さ

export function vibeBarHit(i: number): P3 {
  return p3(-3.6 + 0.8 * i, 2.4 + 0.55 * i, 0);
}

// --- 多様性調整のベース弦。横に 4 本並べる ---
export const BASS_STRING_LEN = 1.0; // 弦の長さ

export function bassStringHit(i: number): P3 {
  return p3(5.2 + 1.3 * i, 3.0, 0);
}

// --- 選抜のベル（0..2 = 1位〜3位）。表彰台状の半円で、打点は半円の頂点 ---
export const BELL_R = 0.6;
const BELL_HITS: readonly P3[] = [p3(13.0, 6.6, 0), p3(14.4, 5.4, 0), p3(15.8, 4.2, 0)];

export function bellHit(i: number): P3 {
  return BELL_HITS[Math.min(BELL_HITS.length - 1, Math.max(0, i))];
}

// --- 落選バー（旧じょうごの縁）と落選箱 ---
export const TRAP_RIM = p3(10.4, 3.2, 0);
export const REJECT_BIN = p3(11.0, 0, 0);
export const REJECT_MOUTH = p3(REJECT_BIN.x, BIN_SIZE.h, 0);

// --- 興味の街（話題の地区が並ぶ円） ---
export const DISTRICT_CENTER = p3(22, 8, 0);
export const DISTRICT_R = 4.4;
export const DISTRICT_DISC_R = 1.1;
export const AGENT_R = 0.5; // エージェントの円の半径

// 話題 i の地区の位置。XY 平面の正 n 角形で、真上から時計回り。
export function districtPos(i: number, n: number): P3 {
  const a = Math.PI / 2 - (i * Math.PI * 2) / Math.max(1, n);
  return p3(
    DISTRICT_CENTER.x + Math.cos(a) * DISTRICT_R,
    DISTRICT_CENTER.y + Math.sin(a) * DISTRICT_R,
    0,
  );
}

// 画面に必ず収める範囲。OrthographicCamera がこの矩形を contain する。
export const VIEW_RECT = { x0: -17.5, x1: 28.5, y0: -4.5, y1: 16 };

// --- ボールの演出の定数。trajectory.ts（合奏）と tourMotion.ts（工程の紹介）の両方が使う ---
export const HOP_HEIGHT = 3.0; // 1 拍の区間で跳ねたときの最高到達点
export const BALL_R = 0.34; // 基準の半径
export const VANISH_CATCH = 0.25; // 受け止められて縮んで消えるまでのビート数
export const VANISH_BIN = 0.3; // 箱に落ちて消えるまでのビート数
export const SIZE_BLEND = 0.15; // 大きさが切り替わるまでのビート数
export const SQUASH_BEATS = 0.12; // 当たった直後に伸び縮みするビート数
export const DROPPED_COLOR = '#b8b8b8'; // 除外・落選したあとの色（色は話題だけに使う）

// --- 工程の紹介のベルトコンベア（下の階）。x 座標は時刻の計算にも使うので show/tour.ts に置く ---
export const TOUR_BELT_Y = -9; // ベルトの上面
export const TOUR_PIPE_IN_MOUTH = p3(-16.2, -4, 0);
export const TOUR_PIPE_OUT_MOUTH = p3(-16.2, -6, 0);
export const TOUR_BIN_TOP_Y = -11; // 除外箱・落選箱の口の高さ（箱の底は -12.2）
export const TOUR_DOOR_W = 1.4; // 扉の幅（ベルトの切れ目の幅）

// 同じスロットで発射されるフォロー内・フォロー外の 2 個が打点で重ならないよう、
// source で進行方向（x）にずらす量。
const LANE_OFF = 0.3;
const BASS_LANE_OFF = 0.25;
const VIBE_LANE_OFF = 0.2;

// Hit ごとのボールの打点。catch だけエージェントの今の位置（agentPos）を使う。
export function hitPoint(hit: Hit, c: Candidate, agentPos: P3): P3 {
  const xo = c.source === 'in' ? -LANE_OFF : LANE_OFF;
  switch (hit.kind) {
    case 'launch':
      return pipeMouth(hit.index);
    case 'drum': {
      const p = DRUM_HITS[hit.index];
      return p3(p.x + xo, p.y, p.z);
    }
    case 'cymbal':
      return CYMBAL_POS;
    case 'scrap':
      return SCRAP_MOUTH;
    case 'vibe': {
      const p = vibeBarHit(hit.index);
      return p3(p.x + (c.source === 'in' ? -VIBE_LANE_OFF : VIBE_LANE_OFF), p.y, p.z);
    }
    case 'bass': {
      const p = bassStringHit(hit.index);
      return p3(p.x + (c.source === 'in' ? -BASS_LANE_OFF : BASS_LANE_OFF), p.y, p.z);
    }
    case 'bell': {
      const p = bellHit(hit.index);
      return p3(p.x + xo, p.y, p.z);
    }
    case 'trap':
      return TRAP_RIM;
    case 'reject':
      return REJECT_MOUTH;
    case 'catch':
      return agentPos;
  }
}
