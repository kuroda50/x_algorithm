// 画面の座標・経路の計算。純粋な関数と定数だけを置き、描画はしない。

export interface Pt {
  x: number;
  y: number;
}

export const pt = (x: number, y: number): Pt => ({ x, y });

// 駅の位置（論理座標）。添字は Stage に対応し、駅 5 はエージェント自身なのでここには無い。
export const STATION_IN = pt(90, 190); // 0: フォロー内（source 'in' の始発駅）
export const STATION_OUT = pt(90, 470); // 0: フォロー外（source 'out' の始発駅）
export const STATION_FILTER = pt(250, 330); // 1: フィルタ
export const STATION_SCORE = pt(390, 330); // 2: スコアリング
export const STATION_DIVERSITY = pt(530, 330); // 3: 多様性調整
export const STATION_SELECT = pt(670, 330); // 4: 選抜

// STATIONS[k] は駅 k の位置（k = 0..4）。駅 0 はフォロー内側のもので、フォロー外は別扱い。
export const STATIONS: readonly Pt[] = [
  STATION_IN,
  STATION_FILTER,
  STATION_SCORE,
  STATION_DIVERSITY,
  STATION_SELECT,
];

// 路線の折れ線。斜め部は 45°。
export const IN_LINE: readonly Pt[] = [STATION_IN, pt(110, 190), STATION_FILTER];
export const OUT_LINE: readonly Pt[] = [STATION_OUT, pt(110, 470), STATION_FILTER];
export const TRUNK_LINE: readonly Pt[] = [
  STATION_FILTER,
  STATION_SCORE,
  STATION_DIVERSITY,
  STATION_SELECT,
];

// 興味の街（右側）の中心と、地区を置く正多角形の半径。
export const DISTRICT_CENTER = pt(975, 340);
export const DISTRICT_R = 250;

// 折れ線の全長。
export function pathLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

export interface PathPoint extends Pt {
  dx: number; // その点での進行方向（単位ベクトル）
  dy: number;
}

// 折れ線上を距離 dist だけ進んだ点と進行方向。dist は両端に clamp される。
export function pointAlong(pts: readonly Pt[], dist: number): PathPoint {
  const last = pts[pts.length - 1];
  let prev = pts[0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    prev = a;
    if (dist <= acc + len || i === pts.length - 1) {
      const t = Math.min(1, Math.max(0, (dist - acc) / len));
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        dx: (b.x - a.x) / len,
        dy: (b.y - a.y) / len,
      };
    }
    acc += len;
  }
  const len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  return { x: last.x, y: last.y, dx: (last.x - prev.x) / len, dy: (last.y - prev.y) / len };
}

// 折れ線の t（0..1）の位置。全長に対する割合。
export function pointAlongFrac(pts: readonly Pt[], t: number): PathPoint {
  const u = Math.min(1, Math.max(0, t));
  return pointAlong(pts, pathLength(pts) * u);
}

// 選抜駅からエージェントへの路線。まず 45° の斜めで縦の差を埋め、そのあと水平
// （縦の差のほうが大きい場合は残りを垂直に）に進む、路線図らしい折れ線を返す。
export function agentRoute(from: Pt, to: Pt): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [from, to];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return [from, pt(from.x + Math.abs(dy) * sx, to.y), to];
  }
  return [from, pt(to.x, from.y + Math.abs(dx) * sy), to];
}

// 移動用のイージング（加速して減速する）。
export function easeInOut(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

// 決定的な疑似乱数 [0, 1)。レーンのずれやパーティクルの向きに使う。
export function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// 話題 i の「地区」の位置。正 n 角形の頂点で、上（-90°）から時計回り。
export function districtPos(i: number, n: number): Pt {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, n);
  return {
    x: DISTRICT_CENTER.x + Math.cos(a) * DISTRICT_R,
    y: DISTRICT_CENTER.y + Math.sin(a) * DISTRICT_R,
  };
}

export const LANE_SPREAD = 40; // レーンの合計幅（±20）

// 本線が束になって流れるよう、エージェントごとの決まったレーン＋候補ごとの小さなずれ。
// 戻り値は経路に垂直な方向のオフセット（px）。
export function laneOffset(agentId: number, agentCount: number, candidateId: number): number {
  const base = agentCount > 1 ? (agentId / (agentCount - 1) - 0.5) * LANE_SPREAD : 0;
  return base + hash01(candidateId) * 8 - 4;
}
