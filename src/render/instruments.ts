// ステージの three.js メッシュを組み立てる。座標は stageLayout.ts の定数を使う。
// すべて XY 平面の平面図形と MeshBasicMaterial（照明・陰影・質感は使わない）。
// ここでは見た目の素材だけを作り、当たりの瞬間の動き（pulse）の適用は renderer.ts が行う。
import * as THREE from 'three';
import { TOPICS } from '../sim/config';
import { VIBE_FREQS } from '../show/score';
import {
  TOUR_X_BELL,
  TOUR_X_DIVERSITY,
  TOUR_X_END,
  TOUR_X_PRESS,
  TOUR_X_REJECT,
  TOUR_X_SCORE,
  TOUR_X_SCRAP,
} from '../show/tour';
import {
  AGENT_R,
  BALL_R,
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
  TOUR_BELT_Y,
  TOUR_BIN_TOP_Y,
  TOUR_DOOR_W,
  TOUR_PIPE_IN_MOUTH,
  TOUR_PIPE_OUT_MOUTH,
  TRAP_RIM,
  VIBE_BAR_LEN,
  VIBE_BAR_T,
  vibeBarHit,
  type P3,
} from './stageLayout';
import { JAW_REST } from './tourMotion';

// 色の定数。白い紙に黒い線の線画。色がつくのは話題・ボール・火花だけ。
export const PAPER = '#ffffff'; // 紙の白。背景と装置の中の塗り
export const INK = '#111111'; // 輪郭・床の線・文字の黒
export const REST = '#9a9a9a'; // 線だけの部品（弦・バー）のふだんの色
export const HAIR = '#d9d9d9'; // 目立たせない線（吊り線・支柱）
export const ANTICIP = '#e6e6e6'; // 当たる直前の予告の塗り
const PIPE_FILL = '#ededed'; // フォロー内パイプの中の塗り
const BG_RING = '#f3f3f3';

const STROKE = 0.07; // 線の太さ（ワールド単位）

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
  mesh: THREE.Object3D; // 半円（膨らむ）
  mat: THREE.MeshBasicMaterial;
}
export interface Press {
  group: THREE.Group; // 軸とヘッドをまとめて上下に動かす
  headMat: THREE.MeshBasicMaterial; // ヘッドの塗り（当たった瞬間に黒くなる）
  restY: number; // ふだんの y（pulse / anticip でここから動かす）
}
export interface TrapDoor {
  hinge: THREE.Group; // 左端の蝶番。回転で開閉する
}
export interface Pipe {
  group: THREE.Group; // 発射の反動で少し左へ
  ringMat: THREE.MeshBasicMaterial; // 口の輪が光る
}
export interface Stage {
  group: THREE.Group;
  instruments: THREE.Group; // 上の階の楽器（床の線・パイプ・ドラム・プレス…）。まとめて隠せる
  bgRings: THREE.Mesh[]; // 拍で拡大する背景の輪
  drums: DrumPad[];
  vibeBars: VibeBar[];
  bassStrings: BassString[];
  bells: Bell[];
  press: Press;
  trapDoor: TrapDoor;
  pipes: Pipe[]; // [フォロー内, フォロー外]
  scrapBin: THREE.Group;
  rejectBin: THREE.Group;
}

const basic = (color: string): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color });

// パルスで光らない部分の共通素材（輪郭・細い支柱・吊り線など）。
const inkMat = basic(INK);
const hairMat = basic(HAIR);
const paperMat = basic(PAPER);

// 中心 (x,y) に置く幅 w・高さ h の矩形。
function rect(w: number, h: number, mat: THREE.Material, x: number, y: number, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
}

// 輪郭の輪（INK）と内側の塗りの 2 枚で作る円。fill は当たりで色が変わる部品には専用のものを渡す。
function strokeCircle(
  r: number,
  fillMat: THREE.Material,
  outlineMat: THREE.Material = inkMat,
): THREE.Group {
  const g = new THREE.Group();
  const ri = Math.max(r - STROKE, 0.01);
  g.add(new THREE.Mesh(new THREE.CircleGeometry(ri, 40), fillMat));
  const ring = new THREE.Mesh(new THREE.RingGeometry(ri, r, 48), outlineMat);
  ring.position.z = 0.01;
  g.add(ring);
  return g;
}

// 細い矩形 4 本の枠（INK）と内側の塗りで作る輪郭つき矩形。
function strokeRect(w: number, h: number, fillMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const iw = Math.max(w - 2 * STROKE, 0.01);
  const ih = Math.max(h - 2 * STROKE, 0.01);
  g.add(rect(iw, ih, fillMat, 0, 0));
  g.add(rect(w, STROKE, inkMat, 0, h / 2 - STROKE / 2, 0.01));
  g.add(rect(w, STROKE, inkMat, 0, -h / 2 + STROKE / 2, 0.01));
  g.add(rect(STROKE, ih, inkMat, -w / 2 + STROKE / 2, 0, 0.01));
  g.add(rect(STROKE, ih, inkMat, w / 2 - STROKE / 2, 0, 0.01));
  return g;
}

// 口の開いた箱。上の開いた「凵」の字（線 3 本）。
function openBin(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const { w, h } = BIN_SIZE;
  g.add(rect(STROKE, h, mat, -w / 2 + STROKE / 2, h / 2));
  g.add(rect(STROKE, h, mat, w / 2 - STROKE / 2, h / 2));
  g.add(rect(w, STROKE, mat, 0, STROKE / 2));
  return g;
}

// 左の画面外（x = -40）から口まで伸びる横のパイプ。
// hollow は中を白く開ける（フォロー外 = 中空）。フォロー内は淡い塗りつぶし。
const PIPE_T = 1.0;
const PIPE_X0 = -40;
function buildPipe(mouth: P3, hollow: boolean): Pipe {
  const g = new THREE.Group();
  const len = mouth.x - PIPE_X0;
  const cx = PIPE_X0 + len / 2;
  const body = strokeRect(len, PIPE_T, basic(hollow ? PAPER : PIPE_FILL));
  body.position.set(cx, mouth.y, 0);
  g.add(body);
  // 口の輪（発射の瞬間に話題の色で光る）
  const ringMat = basic(PAPER);
  const ring = strokeCircle(0.62, ringMat);
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
  const mat = basic(PAPER);
  g.add(strokeCircle(r, mat));
  const inner = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.55, r * 0.55 + STROKE, 32),
    inkMat,
  );
  inner.position.z = 0.02;
  g.add(inner);
  return { group: g, mat, kick: i === 0 };
}

// フィルタのプレス機。CYMBAL_POS の真上に、画面の上の外まで伸びる軸と下端の横長ヘッド。
// ふだんはヘッドの下面が打点の PRESS_CLEAR だけ上で待ち、当たった瞬間に打点まで降りる。
const PRESS_HEAD_W = 1.6;
const PRESS_HEAD_H = 0.45;
const PRESS_SHAFT_W = 0.3;
const PRESS_TOP_Y = 22; // 軸の上端（画面の上の外まで伸ばす）
const PRESS_CLEAR = 0.9; // ふだんヘッドの下面が打点の上に浮く距離

function buildPress(): Press {
  const restY = CYMBAL_POS.y + PRESS_CLEAR;
  const g = new THREE.Group();
  const headMat = basic(PAPER);
  const head = strokeRect(PRESS_HEAD_W, PRESS_HEAD_H, headMat);
  head.position.set(0, PRESS_HEAD_H / 2, 0.01); // 下面が group の原点
  g.add(head);
  const shaftTop = PRESS_TOP_Y - restY; // group の原点から軸の上端まで
  const shaft = strokeRect(PRESS_SHAFT_W, shaftTop - PRESS_HEAD_H, paperMat);
  shaft.position.set(0, (PRESS_HEAD_H + shaftTop) / 2, -0.01);
  g.add(shaft);
  g.position.set(CYMBAL_POS.x, restY, 0);
  return { group: g, headMat, restY };
}

// 選抜の床の扉。(cx, topY) を上面の中心とする水平の板を、左端の蝶番まわりに回して開く。
const TRAP_DOOR_W = 1.4;
const TRAP_DOOR_T = 0.14;
function buildTrapDoor(cx: number, topY: number, w = TRAP_DOOR_W, t = TRAP_DOOR_T): TrapDoor {
  const hinge = new THREE.Group();
  hinge.position.set(cx - w / 2, topY - t / 2, 0);
  hinge.add(rect(w, t, inkMat, w / 2, 0));
  const pin = strokeCircle(0.12, paperMat); // 蝶番の輪
  pin.position.z = 0.01;
  hinge.add(pin);
  return { hinge };
}

// エージェントの円（白い塗り + INK の輪郭）。group の原点は円の中心。
// 輪郭の素材は選択の暗転で色を変えるので userData.outlineMat に入れておく。
export function buildAgent(): { group: THREE.Group; mat: THREE.MeshBasicMaterial } {
  const mat = basic(PAPER);
  const outlineMat = basic(INK);
  const g = new THREE.Group();
  g.add(strokeCircle(AGENT_R, mat, outlineMat));
  g.userData.outlineMat = outlineMat;
  return { group: g, mat };
}

// 床・地区・楽器をまとめて作る。返す Stage の各部品は renderer が pulse で動かす。
// 上の階の楽器（床の線・発射パイプ・ドラム・プレス・箱・ビブラフォン・ベース弦・ベル・
// 落選の扉）は instruments グループに入れ、背景の輪と話題の地区は group の直下に置く。
export function buildStage(): Stage {
  const group = new THREE.Group();
  const instruments = new THREE.Group();
  group.add(instruments);

  // 床の線（y = 0 の細い横線。x は -40 から 17 まで）
  instruments.add(rect(57, STROKE, inkMat, -11.5, 0));

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

  // 話題の地区（話題の色の輪＋白に寄せた淡い塗り）
  const paperC = new THREE.Color(PAPER);
  for (let i = 0; i < TOPICS.length; i++) {
    const p = districtPos(i, TOPICS.length);
    const c = new THREE.Color(TOPICS[i].color);
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(1.02, 40),
      new THREE.MeshBasicMaterial({ color: c.clone().lerp(paperC, 0.86) }),
    );
    fill.position.set(p.x, p.y, Z_DISTRICT);
    group.add(fill);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.02, DISTRICT_DISC_R, 48), basic(TOPICS[i].color));
    ring.position.set(p.x, p.y, Z_DISTRICT + 0.01);
    group.add(ring);
  }

  // 発射パイプ（フォロー内は淡い塗り、フォロー外は中空）
  const pipes = [buildPipe(PIPE_IN_MOUTH, false), buildPipe(PIPE_OUT_MOUTH, true)];
  for (const p of pipes) instruments.add(p.group);

  // フィルタのドラム（宙に浮かせる。支柱はつけない）
  const drums = DRUM_HITS.map((_, i) => buildDrum(i));
  for (const d of drums) instruments.add(d.group);

  // プレス機（CYMBAL_POS の真上から叩き落とす）
  const press = buildPress();
  instruments.add(press.group);

  // 除外箱 / 落選箱
  const scrapBin = openBin(inkMat);
  scrapBin.position.set(SCRAP_BIN.x, 0, 0);
  instruments.add(scrapBin);
  const rejectBin = openBin(inkMat);
  rejectBin.position.set(REJECT_BIN.x, 0, 0);
  instruments.add(rejectBin);

  // ビブラフォン（床からの柱＋鍵盤の棒グラフ状の階段）
  const vibeBars: VibeBar[] = [];
  for (let i = 0; i < VIBE_FREQS.length; i++) {
    const hit = vibeBarHit(i);
    const pillarH = hit.y - VIBE_BAR_T;
    const pillar = strokeRect(VIBE_BAR_LEN, pillarH, paperMat);
    pillar.position.set(hit.x, pillarH / 2, -0.01);
    instruments.add(pillar);
    const mat = basic(PAPER);
    const bar = strokeRect(VIBE_BAR_LEN, VIBE_BAR_T, mat);
    bar.position.set(hit.x, hit.y - VIBE_BAR_T / 2);
    instruments.add(bar);
    vibeBars.push({ mesh: bar, mat, restY: bar.position.y });
  }

  // ベース弦 4 本（横線＋両端から床への細い支柱）
  const bassStrings: BassString[] = [];
  for (let i = 0; i < 4; i++) {
    const hit = bassStringHit(i);
    for (const s of [-1, 1]) {
      instruments.add(rect(STROKE, hit.y, hairMat, hit.x + (s * BASS_STRING_LEN) / 2, hit.y / 2, -0.01));
    }
    const mat = basic(REST);
    const str = rect(BASS_STRING_LEN, STROKE, mat, hit.x, hit.y);
    instruments.add(str);
    bassStrings.push({ mesh: str, mat, restY: hit.y });
  }

  // ベル 3 つ（表彰台状の上半分の円＋床からの細い支柱）
  const bells: Bell[] = [];
  for (let i = 0; i < 3; i++) {
    const hit = bellHit(i);
    const cy = hit.y - BELL_R; // 頂点が打点
    instruments.add(rect(STROKE, cy, inkMat, hit.x, cy / 2, -0.01));
    const mat = basic(PAPER);
    const bell = new THREE.Group();
    // 弧（半分の輪）と底辺が輪郭、内側が塗り
    bell.add(new THREE.Mesh(new THREE.CircleGeometry(BELL_R - STROKE, 32, 0, Math.PI), mat));
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(BELL_R - STROKE, BELL_R, 32, 1, 0, Math.PI),
      inkMat,
    );
    arc.position.z = 0.01;
    bell.add(arc);
    bell.add(rect(2 * BELL_R, STROKE, inkMat, 0, 0, 0.01));
    bell.position.set(hit.x, cy, 0);
    instruments.add(bell);
    bells.push({ mesh: bell, mat });
  }

  // 落選の床の扉
  const trapDoor = buildTrapDoor(TRAP_RIM.x, TRAP_RIM.y);
  instruments.add(trapDoor.hinge);

  return {
    group,
    instruments,
    bgRings,
    drums,
    vibeBars,
    bassStrings,
    bells,
    press,
    trapDoor,
    pipes,
    scrapBin,
    rejectBin,
  };
}

// --- 工程の紹介（最初の 64 拍）のベルトコンベア ---
// 下の階（ベルトの上面 y = TOUR_BELT_Y）に並ぶ機械。renderer が TourMachineState を当てて動かす。
export interface TourLine {
  group: THREE.Group; // 全体。renderer が visible を切り替える
  press: {
    group: THREE.Group;
    headMat: THREE.MeshBasicMaterial;
    restY: number;
    travel: number; // 当たったときヘッドが降りる距離
  };
  scrapDoor: { hinge: THREE.Group };
  rejectDoor: { hinge: THREE.Group };
  gauge: { fill: THREE.Mesh; fillMat: THREE.MeshBasicMaterial; height: number }; // fill は下端を基準に scale.y で伸ばす
  jaws: { left: THREE.Object3D; right: THREE.Object3D };
  bell: { mesh: THREE.Object3D; mat: THREE.MeshBasicMaterial };
  pipes: Pipe[]; // [フォロー内, フォロー外]
  scrapBin: THREE.Group;
  rejectBin: THREE.Group;
}

const TOUR_BELT_T = 0.3; // ベルトの厚さ
export const TOUR_JAW_W = 0.3; // しぼり機の板の幅
const TOUR_JAW_H = 1.3; // しぼり機の板の高さ

export function buildTourLine(): TourLine {
  const group = new THREE.Group();

  // ベルト。扉の位置で切れた 3 本（輪郭つき矩形、塗りは PAPER）
  const beltSeg = (x0: number, x1: number) => {
    const b = strokeRect(x1 - x0, TOUR_BELT_T, paperMat);
    b.position.set((x0 + x1) / 2, TOUR_BELT_Y - TOUR_BELT_T / 2, -0.01);
    group.add(b);
  };
  beltSeg(-16.6, TOUR_X_SCRAP - TOUR_DOOR_W / 2);
  beltSeg(TOUR_X_SCRAP + TOUR_DOOR_W / 2, TOUR_X_REJECT - TOUR_DOOR_W / 2);
  beltSeg(TOUR_X_REJECT + TOUR_DOOR_W / 2, TOUR_X_END + 0.7);

  // 切れ目をふさぐ扉 2 つ（上面が TOUR_BELT_Y、左端の蝶番まわりに下へ開く）
  const scrapDoor = buildTrapDoor(TOUR_X_SCRAP, TOUR_BELT_Y, TOUR_DOOR_W);
  const rejectDoor = buildTrapDoor(TOUR_X_REJECT, TOUR_BELT_Y, TOUR_DOOR_W);
  group.add(scrapDoor.hinge);
  group.add(rejectDoor.hinge);

  // 除外箱・落選箱（口が TOUR_BIN_TOP_Y）
  const scrapBin = openBin(inkMat);
  scrapBin.position.set(TOUR_X_SCRAP, TOUR_BIN_TOP_Y - BIN_SIZE.h, 0);
  group.add(scrapBin);
  const rejectBin = openBin(inkMat);
  rejectBin.position.set(TOUR_X_REJECT, TOUR_BIN_TOP_Y - BIN_SIZE.h, 0);
  group.add(rejectBin);

  // 紹介用のパイプ（フォロー内は淡い塗り、フォロー外は中空）
  const pipes = [buildPipe(TOUR_PIPE_IN_MOUTH, false), buildPipe(TOUR_PIPE_OUT_MOUTH, true)];
  for (const p of pipes) group.add(p.group);

  // プレス。ふだんはヘッドの下面がベルトの上 2.6 で待ち、当たるときボールの上端まで降りる
  const pressRestY = TOUR_BELT_Y + 2.6;
  const pressG = new THREE.Group();
  const headMat = basic(PAPER);
  const head = strokeRect(PRESS_HEAD_W, PRESS_HEAD_H, headMat);
  head.position.set(0, PRESS_HEAD_H / 2, 0.01); // 下面が group の原点
  pressG.add(head);
  const shaftTop = TOUR_BELT_Y + 9 - pressRestY; // group の原点から軸の上端まで
  const shaft = strokeRect(PRESS_SHAFT_W, shaftTop - PRESS_HEAD_H, paperMat);
  shaft.position.set(0, (PRESS_HEAD_H + shaftTop) / 2, -0.01);
  pressG.add(shaft);
  pressG.position.set(TOUR_X_PRESS, pressRestY, 0);
  group.add(pressG);
  const press = {
    group: pressG,
    headMat,
    restY: pressRestY,
    travel: pressRestY - (TOUR_BELT_Y + 2 * BALL_R),
  };

  // 計測ゲート。ベルトをまたぐ門（左右の柱＋横木）と、横木の上に立てた縦長の計器
  const GATE_HALF_W = 0.95;
  const GATE_H = 2.0;
  for (const s of [-1, 1]) {
    group.add(
      rect(STROKE, GATE_H, inkMat, TOUR_X_SCORE + s * GATE_HALF_W, TOUR_BELT_Y + GATE_H / 2),
    );
  }
  group.add(
    rect(2 * GATE_HALF_W + STROKE, STROKE, inkMat, TOUR_X_SCORE, TOUR_BELT_Y + GATE_H),
  );
  const GAUGE_W = 0.5;
  const GAUGE_H = 2.4;
  const gaugeBox = strokeRect(GAUGE_W, GAUGE_H, paperMat);
  gaugeBox.position.set(TOUR_X_SCORE, TOUR_BELT_Y + GATE_H + GAUGE_H / 2, -0.01);
  group.add(gaugeBox);
  const FILL_H = GAUGE_H - 2 * STROKE;
  const fillMat = basic(PAPER);
  const fillGeo = new THREE.PlaneGeometry(0.36, FILL_H);
  fillGeo.translate(0, FILL_H / 2, 0); // 下端を原点に → scale.y で下から伸ばす
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.set(TOUR_X_SCORE, TOUR_BELT_Y + GATE_H + STROKE, 0.01);
  group.add(fill);
  const gauge = { fill, fillMat, height: FILL_H };

  // しぼり機。ベルトの上を滑る左右の縦の板（外側に板を押す短い横棒つき）
  const mkJaw = (side: number): THREE.Object3D => {
    const j = new THREE.Group();
    j.add(strokeRect(TOUR_JAW_W, TOUR_JAW_H, paperMat));
    j.add(rect(0.8, STROKE, inkMat, side * (TOUR_JAW_W / 2 + 0.4), 0));
    j.position.set(
      TOUR_X_DIVERSITY + side * (JAW_REST + TOUR_JAW_W / 2),
      TOUR_BELT_Y + 0.05 + TOUR_JAW_H / 2,
      0.02,
    );
    group.add(j);
    return j;
  };
  const jaws = { left: mkJaw(-1), right: mkJaw(1) };

  // ベル。ベルトの上 1.7 に底辺が来るよう上から吊るす
  const bellMat = basic(PAPER);
  const bellG = new THREE.Group();
  bellG.add(
    new THREE.Mesh(new THREE.CircleGeometry(BELL_R - STROKE, 32, 0, Math.PI), bellMat),
  );
  const bellArc = new THREE.Mesh(
    new THREE.RingGeometry(BELL_R - STROKE, BELL_R, 32, 1, 0, Math.PI),
    inkMat,
  );
  bellArc.position.z = 0.01;
  bellG.add(bellArc);
  bellG.add(rect(2 * BELL_R, STROKE, inkMat, 0, 0, 0.01));
  bellG.position.set(TOUR_X_BELL, TOUR_BELT_Y + 1.7, 0);
  group.add(bellG);
  group.add(
    rect(STROKE, 2.6, hairMat, TOUR_X_BELL, TOUR_BELT_Y + 1.7 + BELL_R + 1.3, -0.01),
  );
  const bell = { mesh: bellG, mat: bellMat };

  // 発射台（ベルトの右端の上面に重ねた短い太線。動かさない）
  group.add(rect(0.9, 0.14, inkMat, TOUR_X_END, TOUR_BELT_Y + 0.07, 0.02));

  return {
    group,
    press,
    scrapDoor,
    rejectDoor,
    gauge,
    jaws,
    bell,
    pipes,
    scrapBin,
    rejectBin,
  };
}
