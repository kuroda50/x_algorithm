// ステージの three.js メッシュを組み立てる。座標は stageLayout.ts の定数を使う。
// すべて XY 平面の平面図形と MeshBasicMaterial（照明・陰影・質感は使わない）。
// ここでは見た目の素材だけを作り、当たりの瞬間の動き（pulse）の適用は renderer.ts が行う。
import * as THREE from 'three';
import { TOPICS } from '../sim/config';
import { VIBE_FREQS } from '../show/score';
import {
  AGENT_R,
  BASS_STRING_LEN,
  bassStringHit,
  BELL_R,
  bellHit,
  BIN_SIZE,
  CYMBAL_POS,
  DISTRICT_DISC_R,
  districtPos,
  DRUM_HITS,
  DRUM_RADII,
  PIPE_IN_MOUTH,
  PIPE_OUT_MOUTH,
  REJECT_BIN,
  SCRAP_BIN,
  TRAP_RIM,
  VIBE_BAR_LEN,
  VIBE_BAR_T,
  vibeBarHit,
  type P3,
} from './stageLayout';

// 色の定数。色がつくのは話題・ボール・火花だけで、装置はすべて白〜灰色。
export const REST = '#8f95a6'; // 装置のふだんの色
export const WHITE = '#ffffff'; // 当たった瞬間の色
export const DARK = '#1a1d27'; // 支柱・鍵盤の下の柱など目立たせない部分
export const BG = '#06070b'; // 背景
const FLOOR_LINE = '#3a3f4d';
const BG_RING = '#0e1017';

// 奥行き（z）は重なり順だけを決める。
const Z_BG_RING = -2;
const Z_DISTRICT = -1;

// 当たった瞬間に動かす部品の参照をまとめたもの。
export interface DrumPad {
  group: THREE.Group; // 全体が膨らむ（kick は大きめ）
  mat: THREE.MeshBasicMaterial;
  kick: boolean;
}
export interface VibeBar {
  mesh: THREE.Mesh; // 鍵盤（沈む）
  mat: THREE.MeshBasicMaterial;
  restY: number;
}
export interface BassString {
  mesh: THREE.Mesh; // 弦（縦に震える）
  mat: THREE.MeshBasicMaterial;
  restY: number;
}
export interface Bell {
  mesh: THREE.Mesh; // 半円（膨らむ）
  mat: THREE.MeshBasicMaterial;
}
export interface Bar {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseRot: number;
}
export interface Pipe {
  group: THREE.Group; // 発射の反動で少し左へ
  ringMat: THREE.MeshBasicMaterial; // 口の輪が光る
}
export interface Stage {
  group: THREE.Group;
  bgRings: THREE.Mesh[]; // 拍で拡大する背景の輪
  drums: DrumPad[];
  vibeBars: VibeBar[];
  bassStrings: BassString[];
  bells: Bell[];
  cymbalBar: Bar;
  trapBar: Bar;
  pipes: Pipe[]; // [フォロー内, フォロー外]
  scrapBin: THREE.Group;
  rejectBin: THREE.Group;
}

const basic = (color: string): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color });

// パルスで光らない部分の共通素材（柱・吊り線・床の線など）。
const darkMat = basic(DARK);

// 中心 (x,y) に置く幅 w・高さ h の矩形。
function rect(w: number, h: number, mat: THREE.Material, x: number, y: number, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
}

// 口の開いた箱。上の開いた「凵」の字（線 3 本）。
function openBin(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const t = 0.1;
  const { w, h } = BIN_SIZE;
  g.add(rect(t, h, mat, -w / 2 + t / 2, h / 2));
  g.add(rect(t, h, mat, w / 2 - t / 2, h / 2));
  g.add(rect(w, t, mat, 0, t / 2));
  return g;
}

// 左の画面外（x = -40）から口まで伸びる横のパイプ。
// hollow は中を背景色で開けて上下の縁だけにする（フォロー外 = 中空）。
const PIPE_T = 1.0;
const PIPE_X0 = -40;
function buildPipe(mouth: P3, hollow: boolean): Pipe {
  const g = new THREE.Group();
  const len = mouth.x - PIPE_X0;
  const cx = PIPE_X0 + len / 2;
  if (hollow) {
    g.add(rect(len, PIPE_T, basic(BG), cx, mouth.y));
    const edge = PIPE_T / 2 - 0.05;
    g.add(rect(len, 0.1, basic(REST), cx, mouth.y + edge));
    g.add(rect(len, 0.1, basic(REST), cx, mouth.y - edge));
  } else {
    g.add(rect(len, PIPE_T, basic(REST), cx, mouth.y));
  }
  // 口の輪（発射の瞬間に白く光る）
  const ringMat = basic(REST);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), ringMat);
  ring.position.set(mouth.x, mouth.y, 0.01);
  g.add(ring);
  return { group: g, ringMat };
}

// ドラム。打点（円の頂点）が円の上端に来るよう組む。内側の輪でスピーカー風。
function buildDrum(i: number): DrumPad {
  const hit = DRUM_HITS[i];
  const r = DRUM_RADII[i];
  const g = new THREE.Group();
  g.position.set(hit.x, hit.y - r, 0);
  const mat = basic(REST);
  g.add(new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat));
  const inner = new THREE.Mesh(new THREE.RingGeometry(r * 0.52, r * 0.66, 32), darkMat);
  inner.position.z = 0.01;
  g.add(inner);
  return { group: g, mat, kick: i === 0 };
}

// 傾いた棒（除外バー / 落選バー）。当たると光って揺れる。
function buildBar(px: P3, len: number, thick: number, rot: number): { group: THREE.Group; bar: Bar } {
  const g = new THREE.Group();
  const mat = basic(REST);
  const mesh = rect(len, thick, mat, px.x, px.y, 0);
  mesh.rotation.z = rot;
  g.add(mesh);
  return { group: g, bar: { mesh, mat, baseRot: rot } };
}

// エージェントの円（塗りつぶし）。group の原点は円の中心。
export function buildAgent(): { group: THREE.Group; mat: THREE.MeshBasicMaterial } {
  const mat = basic(WHITE);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CircleGeometry(AGENT_R, 32), mat));
  return { group: g, mat };
}

// 床・地区・楽器をまとめて作る。返す Stage の各部品は renderer が pulse で動かす。
export function buildStage(): Stage {
  const group = new THREE.Group();

  // 床の線（y = 0 の細い横線。x は -40 から 17 まで）
  group.add(rect(57, 0.06, basic(FLOOR_LINE), -11.5, 0));

  // 背景の大きな輪。拍で少し拡大する。
  const bgRings: THREE.Mesh[] = [];
  const BG_RING_DEFS = [
    { x: -9.8, y: 6, r: 5 },
    { x: 0, y: 5, r: 6 },
    { x: 7.2, y: 4, r: 4.5 },
    { x: 22, y: 8, r: 7 },
  ];
  for (const d of BG_RING_DEFS) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(d.r * 0.94, d.r, 72), basic(BG_RING));
    ring.position.set(d.x, d.y, Z_BG_RING);
    group.add(ring);
    bgRings.push(ring);
  }

  // 話題の地区（話題の色の輪＋同じ色の暗い塗り）
  for (let i = 0; i < TOPICS.length; i++) {
    const p = districtPos(i, TOPICS.length);
    const c = new THREE.Color(TOPICS[i].color);
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(1.02, 40),
      new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.16) }),
    );
    fill.position.set(p.x, p.y, Z_DISTRICT);
    group.add(fill);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.02, DISTRICT_DISC_R, 48), basic(TOPICS[i].color));
    ring.position.set(p.x, p.y, Z_DISTRICT + 0.01);
    group.add(ring);
  }

  // 発射パイプ（フォロー内は実線、フォロー外は中空）
  const pipes = [buildPipe(PIPE_IN_MOUTH, false), buildPipe(PIPE_OUT_MOUTH, true)];
  for (const p of pipes) group.add(p.group);

  // フィルタのドラム（宙に浮かせる。支柱はつけない）
  const drums = DRUM_HITS.map((_, i) => buildDrum(i));
  for (const d of drums) group.add(d.group);

  // 除外バー（傾いた棒＋画面外まで伸びる吊り線）
  const cymbal = buildBar(CYMBAL_POS, 1.8, 0.12, -0.35);
  group.add(cymbal.group);
  const wireH = 12;
  group.add(rect(0.04, wireH, darkMat, CYMBAL_POS.x, CYMBAL_POS.y + wireH / 2, -0.01));

  // 除外箱 / 落選箱
  const scrapBin = openBin(basic(REST));
  scrapBin.position.set(SCRAP_BIN.x, 0, 0);
  group.add(scrapBin);
  const rejectBin = openBin(basic(REST));
  rejectBin.position.set(REJECT_BIN.x, 0, 0);
  group.add(rejectBin);

  // ビブラフォン（床からの柱＋鍵盤の棒グラフ状の階段）
  const vibeBars: VibeBar[] = [];
  for (let i = 0; i < VIBE_FREQS.length; i++) {
    const hit = vibeBarHit(i);
    const pillarH = hit.y - VIBE_BAR_T;
    group.add(rect(VIBE_BAR_LEN, pillarH, darkMat, hit.x, pillarH / 2, -0.01));
    const mat = basic(REST);
    const bar = rect(VIBE_BAR_LEN, VIBE_BAR_T, mat, hit.x, hit.y - VIBE_BAR_T / 2);
    group.add(bar);
    vibeBars.push({ mesh: bar, mat, restY: bar.position.y });
  }

  // ベース弦 4 本（横線＋両端から床への細い支柱）
  const bassStrings: BassString[] = [];
  for (let i = 0; i < 4; i++) {
    const hit = bassStringHit(i);
    for (const s of [-1, 1]) {
      group.add(rect(0.06, hit.y, darkMat, hit.x + (s * BASS_STRING_LEN) / 2, hit.y / 2, -0.01));
    }
    const mat = basic(REST);
    const str = rect(BASS_STRING_LEN, 0.07, mat, hit.x, hit.y);
    group.add(str);
    bassStrings.push({ mesh: str, mat, restY: hit.y });
  }

  // ベル 3 つ（表彰台状の上半分の円＋床からの細い支柱）
  const bells: Bell[] = [];
  for (let i = 0; i < 3; i++) {
    const hit = bellHit(i);
    const cy = hit.y - BELL_R; // 頂点が打点
    group.add(rect(0.14, cy, darkMat, hit.x, cy / 2, -0.01));
    const mat = basic(REST);
    const bell = new THREE.Mesh(new THREE.CircleGeometry(BELL_R, 32, 0, Math.PI), mat);
    bell.position.set(hit.x, cy, 0);
    group.add(bell);
    bells.push({ mesh: bell, mat });
  }

  // 落選バー
  const trap = buildBar(TRAP_RIM, 1.4, 0.12, -0.6);
  group.add(trap.group);

  return {
    group,
    bgRings,
    drums,
    vibeBars,
    bassStrings,
    bells,
    cymbalBar: cymbal.bar,
    trapBar: trap.bar,
    pipes,
    scrapBin,
    rejectBin,
  };
}
