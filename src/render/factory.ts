// 工場ラインの描画。描画に依存しない純粋な関数と、機械・ベルトを Canvas に描く関数を置く。
// 1 拍の中の位置を phase（0 以上 1 未満、拍頭で 0）としたとき、音と動きの対応は:
//   phase 0    キック: プレスと削り機が打つ。4 拍ごとの強拍はより深く打つ
//   phase 0.5  ハット: 2 つの搬入口のシャッターが開き、新しい候補が出る
//   phase 0.75 低い音: 検品機が不良品をはじく / カチッ: 仕分けアームが落選品を払い落とす
import { MOVE_FRACTION } from '../sim/config';
import { easeInOut, pathLength, pointAlong, type Pt } from './layout';

// hit の瞬間に 1 になる打撃の波形。phase と hit は 1 拍の中の位置（0..1）。
// hit の直前 windup 拍で 0 → 1 に加速して振り下ろし、hit の後 release 拍で 1 → 0 に戻る。それ以外は 0。
// 拍をまたいで連続（phase 0.99 と 0.0 がつながる）。
export function strokeAt(phase: number, hit: number, windup = 0.12, release = 0.25): number {
  const d = (((phase - hit) % 1) + 1) % 1; // 打ってからの経過
  if (d < release) return 1 - d / release;
  if (d > 1 - windup) return ((d - (1 - windup)) / windup) ** 3;
  return 0;
}

// 1 拍の中でベルトが進んだ割合（0..1）。候補の移動と同じイージング。
export function beltProgress(beat: number): number {
  const phase = beat - Math.floor(beat);
  return easeInOut(Math.min(1, phase / MOVE_FRACTION));
}

// ベルトのコマの間隔の目安（px）。
export const SLAT_PITCH = 20;

// 長さ pathLen のベルトに並ぶコマの位置（始点からの距離、昇順、0 以上 pathLen 未満）。
// コマの間隔は pathLen / Math.max(1, Math.round(pathLen / SLAT_PITCH))。
// progress が 0 と 1 で同じ並びになる（1 拍でちょうど pathLen ぶん進み、元に戻る）。
export function slatDistances(pathLen: number, progress: number): number[] {
  if (pathLen <= 0) return [];
  const n = Math.max(1, Math.round(pathLen / SLAT_PITCH));
  const pitch = pathLen / n;
  const shift = (progress % 1) * pathLen;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i * pitch + shift) % pathLen);
  out.sort((a, b) => a - b);
  return out;
}

// その拍頭の打撃が強拍（4 拍ごと）かどうか。振り下ろし中（phase が 1 に近い）は次の拍で判定する。
export function isAccent(beat: number): boolean {
  return Math.round(beat) % 4 === 0;
}

export function clamp01(u: number): number {
  return Math.min(1, Math.max(0, u));
}

// 描画に使う色。renderer の Colors と同じ名前で受け取る。
export interface FactoryColors {
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  lineIn: string;
  danger: string;
}

export const BELT_W = 56; // ベルトの幅（候補のレーンのずれ ±24 が収まる幅）

function strokePolyline(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

// 折れ線を法線方向に off だけずらした折れ線。角はミトアでつなぐ。
function offsetPath(pts: readonly Pt[], off: number): Pt[] {
  const n = pts.length;
  const normals: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push({ x: -dy / len, y: dx / len });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push({ x: pts[0].x + normals[0].x * off, y: pts[0].y + normals[0].y * off });
    } else if (i === n - 1) {
      const m = normals[n - 2];
      out.push({ x: pts[i].x + m.x * off, y: pts[i].y + m.y * off });
    } else {
      const a = normals[i - 1];
      const b = normals[i];
      let mx = a.x + b.x;
      let my = a.y + b.y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const cos = Math.max(0.2, mx * b.x + my * b.y);
      out.push({ x: pts[i].x + (mx * off) / cos, y: pts[i].y + (my * off) / cos });
    }
  }
  return out;
}

// 路線の折れ線をベルトコンベアとして描く。本体＋両端のレール＋流れるコマ。
// legs は、候補がこのベルトを何拍かけて渡るか。コマは 1 拍で全長の 1 / legs だけ進む。
export function drawBelt(
  ctx: CanvasRenderingContext2D,
  pts: readonly Pt[],
  railColor: string,
  colors: FactoryColors,
  beat: number,
  legs = 1,
): void {
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 本体
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = BELT_W;
  strokePolyline(ctx, pts);
  // 両端のレール
  ctx.globalAlpha = 1;
  ctx.strokeStyle = railColor;
  ctx.lineWidth = 2;
  for (const s of [-1, 1]) strokePolyline(ctx, offsetPath(pts, (s * BELT_W) / 2));
  // コマ（進行方向と垂直な細い線。1 拍でちょうど元の並びに戻る）
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = colors.textMuted;
  ctx.lineWidth = 1.5;
  const half = BELT_W / 2 - 4;
  const legLen = pathLength(pts) / legs;
  const slats = slatDistances(legLen, beltProgress(beat));
  for (let k = 0; k < legs; k++) {
    for (const d of slats) {
      const p = pointAlong(pts, k * legLen + d);
      ctx.beginPath();
      ctx.moveTo(p.x + p.dy * half, p.y - p.dx * half);
      ctx.lineTo(p.x - p.dy * half, p.y + p.dx * half);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

const HOPPER = 44; // 搬入口の一辺
const HOPPER_OPEN = 22; // 開口部の高さ

// 搬入口。ベルトが出ていく側（右）に開口部を持つ四角い箱。右辺が駅の位置に来る。
export function drawHopper(ctx: CanvasRenderingContext2D, p: Pt, colors: FactoryColors): void {
  const x0 = p.x - HOPPER;
  const y0 = p.y - HOPPER / 2;
  const oy0 = p.y - HOPPER_OPEN / 2;
  const oy1 = p.y + HOPPER_OPEN / 2;
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(x0, y0, HOPPER, HOPPER);
  ctx.fill();
  // 開口部の部分だけ右辺の輪郭を描かない
  ctx.beginPath();
  ctx.moveTo(p.x, oy0);
  ctx.lineTo(p.x, y0);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0, y0 + HOPPER);
  ctx.lineTo(p.x, y0 + HOPPER);
  ctx.lineTo(p.x, oy1);
  ctx.stroke();
}

// 搬入口のシャッター（候補より前に重ねる）。s = strokeAt(phase, 0.5) で、1 が全開。
export function drawHopperShutter(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  s: number,
  colors: FactoryColors,
): void {
  const top = p.y - HOPPER_OPEN / 2 - s * HOPPER_OPEN;
  ctx.fillStyle = colors.border;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - 3, top, 6, HOPPER_OPEN);
  ctx.fill();
  ctx.stroke();
}

// 検品機（候補より下に来る部分）。ベルトをまたぐ門型と、不良品を落とす下の落とし口。
// reject が true の間は枠を danger 色にする。
export function drawInspector(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  reject: boolean,
  colors: FactoryColors,
): void {
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = reject ? colors.danger : colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - 16, p.y - 54, 32, 10); // 上の柱
  ctx.rect(p.x - 20.5, p.y + 32, 5, 28); // 落とし口の左壁
  ctx.rect(p.x + 15.5, p.y + 32, 5, 28); // 落とし口の右壁
  ctx.fill();
  ctx.stroke();
}

// 検品機の梁（候補より前に重ねる）。梁に沿ってスキャン線が往復する。
export function drawInspectorBeam(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  phase: number,
  pulseV: number,
  reject: boolean,
  colors: FactoryColors,
): void {
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = reject ? colors.danger : colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - 2.5, p.y - 44, 5, 76); // 梁（ベルトをまたぐ）
  ctx.fill();
  ctx.stroke();
  // スキャン線。駅に候補が着いた直後（pulseV が大きい）ほど明るい
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const sy = p.y - 36 + tri * 58;
  ctx.globalAlpha = 0.25 + 0.75 * pulseV;
  ctx.fillStyle = colors.lineIn;
  ctx.beginPath();
  ctx.rect(p.x - 8, sy, 16, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// プレス（候補より下に来る部分）。あごを支える門型の枠。
export function drawPress(ctx: CanvasRenderingContext2D, p: Pt, colors: FactoryColors): void {
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - 30, p.y - 64, 8, 128); // 左の柱
  ctx.rect(p.x + 22, p.y - 64, 8, 128); // 右の柱
  ctx.rect(p.x - 30, p.y - 70, 60, 6); // 上の横梁
  ctx.rect(p.x - 30, p.y + 64, 60, 6); // 下の横梁
  ctx.fill();
  ctx.stroke();
}

const PRESS_GAP = 52; // あごの内側の縁とベルト中心の距離（待機時）

// プレスのあご（候補より前に重ねる）。s = strokeAt(phase, 0)、accent は強拍。
export function drawPressJaws(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  s: number,
  accent: boolean,
  colors: FactoryColors,
): void {
  const gap = PRESS_GAP - (accent ? 26 : 22) * s;
  const jawW = 40;
  const jawH = 14;
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - jawW / 2, p.y - gap - jawH, jawW, jawH); // 上のあご
  ctx.rect(p.x - jawW / 2, p.y + gap, jawW, jawH); // 下のあご
  ctx.fill();
  ctx.stroke();
  // 打った瞬間の衝撃線
  if (s > 0.5) {
    ctx.globalAlpha = s;
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const dx of [-12, 0, 12]) {
      ctx.moveTo(p.x + dx, p.y - gap + 4);
      ctx.lineTo(p.x + dx, p.y + gap - 4);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u);

// 削り機。ベルトの上下に逆回転する歯車。1 拍で歯 1 枚ぶん（π/4）だけ回る。
export function drawTrimmer(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  beat: number,
  colors: FactoryColors,
): void {
  const phase = beat - Math.floor(beat);
  const rot = ((Math.floor(beat) + easeOut(Math.min(1, phase / 0.2))) * Math.PI) / 4;
  const grow = isAccent(beat) ? 2 * strokeAt(phase, 0) : 0;
  gear(ctx, p.x, p.y - 42, 18 + grow, rot, colors);
  gear(ctx, p.x, p.y + 42, 18 + grow, -rot, colors);
}

// 歯 8 枚の歯車。rot はラジアン。
function gear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  colors: FactoryColors,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.rect(r - 3, -3.2, 9, 6.4);
  }
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// 仕分けゲート（候補より下に来る部分）。ベルトの上側に支点を持つアームの支柱。
export function drawSorter(ctx: CanvasRenderingContext2D, p: Pt, colors: FactoryColors): void {
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - 4, p.y - 48, 8, 22); // 支点の柱
  ctx.fill();
  ctx.stroke();
}

// 仕分けアーム（候補より前に重ねる）。s = strokeAt(phase, 0.75)。
// 休み（ベルトの上の縁に沿って水平）からベルトを横切って下向きに振れ、落選品を下の箱へ払う。
export function drawSorterArm(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  s: number,
  colors: FactoryColors,
): void {
  const px = p.x;
  const py = p.y - 44; // 支点
  const ang = ((-90 + 100 * s) * Math.PI) / 180; // 鉛直下向きを 0 とする角度
  const ex = px + Math.sin(ang) * 60;
  const ey = py + Math.cos(ang) * 60;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.fillStyle = colors.surface;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export const BIN_W = 60;
export const BIN_H = 40;

// 上が開いた箱。物が落ちた直後は sink だけ沈めて描く。
export function drawBin(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  label: string,
  sink: number,
  colors: FactoryColors,
): void {
  const y = p.y + sink;
  ctx.fillStyle = colors.surface;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x - BIN_W / 2, y - BIN_H / 2);
  ctx.lineTo(p.x - BIN_W / 2, y + BIN_H / 2);
  ctx.lineTo(p.x + BIN_W / 2, y + BIN_H / 2);
  ctx.lineTo(p.x + BIN_W / 2, y - BIN_H / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.textMuted;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, p.x, y + 6);
}

// 小節ランプ。強拍を先頭に 4 つの丸で今の拍を示す。
export function drawBarLamps(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  beat: number,
  colors: FactoryColors,
): void {
  const lit = ((Math.floor(beat) % 4) + 4) % 4;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(x + (i - 1.5) * 16, y, i === 0 ? 4 : 3, 0, Math.PI * 2);
    if (i === lit) {
      ctx.fillStyle = colors.text;
      ctx.fill();
    } else {
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
