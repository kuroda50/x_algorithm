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
  vibeBarHit,
  type P3,
} from './stageLayout';

// 色の定数。色がつくのは話題・ボール・火花だけで、装置はすべて白〜灰色。
export const REST = '#b8bdcc'; // ボールが当たる面（皮・鍵盤・弦・バー・パイプ）のふだんの色
export const WHITE = '#ffffff'; // 当たった瞬間の色
export const STRUCT = '#5b6275'; // 支柱・枠・輪郭線
export const SHELL = '#1c202b'; // 胴・共鳴管・台座の塗り
export const BG = '#06070b'; // 背景
const FLOOR_LINE = '#4a5062';

// 奥行き（z）は重なり順だけを決める。
const Z_DISTRICT = -1;

// 当たった瞬間に動かす部品の参照をまとめたもの。
export interface DrumPad {
  group: THREE.Group; // 全体が膨らむ（kick は大きめ）
  mat: THREE.MeshBasicMaterial;
  kick: boolean;
}
export interface VibeBar {
  mesh: THREE.Object3D; // 鍵盤（沈む）
  mat: THREE.MeshBasicMaterial;
  restY: number;
}
export interface BassString {
  mesh: THREE.Mesh; // 弦（縦に震える）
  mat: THREE.MeshBasicMaterial;
  restY: number;
}
export interface Bell {
  mesh: THREE.Object3D; // 鐘と縁（膨らむ）
  mat: THREE.MeshBasicMaterial;
}
export interface Bar {
  mesh: THREE.Object3D;
  mat: THREE.MeshBasicMaterial;
  baseRot: number;
}
export interface Pipe {
  group: THREE.Group; // 発射の反動で少し左へ
  ringMat: THREE.MeshBasicMaterial; // 口の輪が光る
}
export interface Stage {
  group: THREE.Group;
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

// パルスで光らない部分の共通素材（支柱・枠・輪郭など）。
const structMat = basic(STRUCT);
// ドラムのスタンド。楽器より目立たないよう暗くする。
const standMat = basic('#2c313f');
// 光らせない REST 色の小物（糸巻き・ベルの舌）の共通素材。
const restStillMat = basic(REST);

// 中心 (x,y) に置く幅 w・高さ h の矩形。
function rect(w: number, h: number, mat: THREE.Material, x: number, y: number, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
}

// 長さ len・太さ thick のカプセル（矩形の両端に半径 thick/2 の円）。原点は中心。
function capsule(len: number, thick: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const w = Math.max(0, len - thick);
  if (w > 0) g.add(rect(w, thick, mat, 0, 0));
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(thick / 2, 24), mat);
    c.position.x = (s * w) / 2;
    g.add(c);
  }
  return g;
}

// stroke 色の輪郭の内側に fill 色を塗った矩形（太さ t の縁）。原点は中心。
function outlinedRect(w: number, h: number, fill: string, stroke: string, t = 0.07): THREE.Group {
  const g = new THREE.Group();
  g.add(rect(w, h, basic(stroke), 0, 0));
  g.add(rect(Math.max(0, w - 2 * t), Math.max(0, h - 2 * t), basic(fill), 0, 0, 0.01));
  return g;
}

// 口の開いた箱。上の開いた「凵」の字（線 3 本）。
function openBin(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const t = 0.14;
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
    g.add(rect(len, 0.14, basic(REST), cx, mouth.y + edge));
    g.add(rect(len, 0.14, basic(REST), cx, mouth.y - edge));
  } else {
    g.add(rect(len, PIPE_T, basic(REST), cx, mouth.y));
  }
  // 口の輪（発射の瞬間に白く光る）
  const ringMat = basic(REST);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 40), ringMat);
  ring.position.set(mouth.x, mouth.y, 0.01);
  g.add(ring);
  return { group: g, ringMat };
}

// ドラム。group の原点は打点（皮・皿の上端）。中身はローカル座標で下向きに組む。
// kick/snare/shaker は太鼓（皮＋胴）、hat/openHat は横から見たシンバル（潰した円）。
// 戻り値の bottom は楽器の下端のローカル y（スタンドを伸ばす起点）。
function buildDrum(i: number): { pad: DrumPad; bottom: number } {
  const hit = DRUM_HITS[i];
  const r = DRUM_RADII[i];
  const g = new THREE.Group();
  g.position.set(hit.x, hit.y, 0);
  const mat = basic(REST);
  let bottom: number;
  if (i === 2 || i === 3) {
    // シンバル: 縦に潰した円を皿に見立てる
    const dish = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat);
    dish.scale.y = 0.16;
    dish.position.y = -r * 0.16;
    g.add(dish);
    bottom = -r * 0.32;
    if (i === 3) {
      // ハイハットは 2 枚重ね
      const lower = new THREE.Mesh(new THREE.CircleGeometry(r, 40), structMat);
      lower.scale.y = 0.16;
      lower.position.set(0, -r * 0.16 - 0.3, -0.01);
      g.add(lower);
      bottom -= 0.3;
    }
  } else {
    // 太鼓: 皮（光る面）＋胴
    const skin = capsule(2 * r, 0.26, mat);
    skin.position.y = -0.13;
    g.add(skin);
    const body = outlinedRect(2 * r * 0.86, r * 0.9, SHELL, STRUCT);
    body.position.y = -0.26 - r * 0.45;
    g.add(body);
    bottom = -0.26 - r * 0.9;
  }
  return { pad: { group: g, mat, kick: i === 0 }, bottom };
}

// 傾いたバー（除外バー / 落選バー）。当たると光って揺れる。
function buildBar(px: P3, len: number, rot: number): { group: THREE.Group; bar: Bar } {
  const g = new THREE.Group();
  const mat = basic(REST);
  const mesh = capsule(len, 0.2, mat);
  mesh.position.set(px.x, px.y, 0);
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

  // 床の線（y = 0 の細い横線。画面の端から端まで）
  group.add(rect(120, 0.08, basic(FLOOR_LINE), 0, 0));

  // 話題の地区（話題の色の輪＋同じ色の暗い塗り）
  for (let i = 0; i < TOPICS.length; i++) {
    const p = districtPos(i, TOPICS.length);
    const c = new THREE.Color(TOPICS[i].color);
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(1.02, 40),
      new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.22) }),
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

  // フィルタのドラムと、床までのスタンド（スタンドは group の外。弾みで拡大しない）
  const drums = DRUM_HITS.map((_, i) => buildDrum(i));
  for (const { pad, bottom } of drums) {
    group.add(pad.group);
    const top = pad.group.position.y + bottom;
    group.add(rect(0.08, top, standMat, pad.group.position.x, top / 2, -0.02));
  }

  // 除外バー（傾いたカプセル）
  const cymbal = buildBar(CYMBAL_POS, 1.8, -0.35);
  group.add(cymbal.group);

  // 除外箱 / 落選箱
  const scrapBin = openBin(structMat);
  scrapBin.position.set(SCRAP_BIN.x, 0, 0);
  group.add(scrapBin);
  const rejectBin = openBin(structMat);
  rejectBin.position.set(REJECT_BIN.x, 0, 0);
  group.add(rejectBin);

  // ビブラフォン（鍵盤＋共鳴管＋斜めの桟と脚）
  const vibeBars: VibeBar[] = [];
  for (let i = 0; i < VIBE_FREQS.length; i++) {
    const hit = vibeBarHit(i);
    const mat = basic(REST);
    const key = capsule(VIBE_BAR_LEN, 0.26, mat);
    key.position.set(hit.x, hit.y - 0.13, 0);
    group.add(key);
    vibeBars.push({ mesh: key, mat, restY: key.position.y });
    // 共鳴管。下端は床から 0.5 以上浮かせる
    const top = hit.y - 0.38;
    const len = Math.min(2.2 - 0.12 * i, top - 0.5);
    const tube = outlinedRect(0.34, len, SHELL, STRUCT);
    tube.position.set(hit.x, top - len / 2, -0.02);
    group.add(tube);
  }
  const vibeEnd0 = vibeBarHit(0);
  const vibeEnd1 = vibeBarHit(VIBE_FREQS.length - 1);
  const rx0 = vibeEnd0.x - 0.5;
  const ry0 = vibeEnd0.y - 0.34;
  const rx1 = vibeEnd1.x + 0.5;
  const ry1 = vibeEnd1.y - 0.34;
  const rail = rect(
    Math.hypot(rx1 - rx0, ry1 - ry0),
    0.1,
    structMat,
    (rx0 + rx1) / 2,
    (ry0 + ry1) / 2,
    -0.01,
  );
  rail.rotation.z = Math.atan2(ry1 - ry0, rx1 - rx0);
  group.add(rail);
  for (const [lx, top] of [
    [rx0, ry0],
    [rx1, ry1],
  ] as const) {
    group.add(rect(0.1, top, structMat, lx, top / 2, -0.03));
  }

  // ベース（箱型の胴＋響孔の上に、支柱で張った 4 本の弦）
  const bassBody = outlinedRect(5.7, 1.3, SHELL, STRUCT);
  bassBody.position.set(7.15, 0.65, -0.02);
  group.add(bassBody);
  const hole = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 32), structMat);
  hole.position.set(7.15, 0.65, -0.004);
  group.add(hole);
  const bassStrings: BassString[] = [];
  for (let i = 0; i < 4; i++) {
    const hit = bassStringHit(i);
    for (const s of [-1, 1]) {
      const px = hit.x + (s * BASS_STRING_LEN) / 2;
      group.add(rect(0.08, hit.y - 1.3, structMat, px, (1.3 + hit.y) / 2, -0.01));
      const peg = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), restStillMat);
      peg.position.set(px, hit.y, 0.01);
      group.add(peg);
    }
    const mat = basic(REST);
    const str = rect(BASS_STRING_LEN, 0.1, mat, hit.x, hit.y);
    group.add(str);
    bassStrings.push({ mesh: str, mat, restY: hit.y });
  }

  // ベル 3 つ（台座に載った鐘。group の原点は鐘の中心、打点は頂点）
  const bells: Bell[] = [];
  for (let i = 0; i < 3; i++) {
    const hit = bellHit(i);
    const cy = hit.y - BELL_R;
    const mat = basic(REST);
    const bell = new THREE.Group();
    bell.position.set(hit.x, cy, 0);
    bell.add(new THREE.Mesh(new THREE.CircleGeometry(BELL_R, 32, 0, Math.PI), mat));
    const rim = capsule(2 * BELL_R + 0.5, 0.14, mat);
    rim.position.y = -0.07;
    bell.add(rim);
    const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), restStillMat);
    tongue.position.y = -0.34;
    bell.add(tongue);
    group.add(bell);
    bells.push({ mesh: bell, mat });
    // 台座（鐘の group の外。床に置く）
    const pedH = cy - 0.6;
    const pedestal = outlinedRect(1.25, pedH, SHELL, STRUCT);
    pedestal.position.set(hit.x, pedH / 2, -0.02);
    group.add(pedestal);
  }

  // 落選バー
  const trap = buildBar(TRAP_RIM, 1.4, -0.6);
  group.add(trap.group);

  return {
    group,
    drums: drums.map((d) => d.pad),
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
