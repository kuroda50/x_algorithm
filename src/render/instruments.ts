// ステージの three.js メッシュを組み立てる。座標は stageLayout.ts の定数を使う。
// ここでは見た目の素材だけを作り、当たりの瞬間の動き（pulse）の適用は renderer.ts が行う。
import * as THREE from 'three';
import { TOPICS } from '../sim/config';
import { VIBE_FREQS } from '../show/score';
import {
  BASS_STRING_X0,
  BASS_STRING_X1,
  BASS_STRING_ZS,
  BASS_Y,
  BELL_COLORS,
  BELL_X,
  BELL_Y,
  BELL_ZS,
  BIN_SIZE,
  CYMBAL_POS,
  DISTRICT_DISC_R,
  districtPos,
  DRUM_HITS,
  PIPE_IN_COLOR,
  PIPE_IN_MOUTH,
  PIPE_OUT_COLOR,
  PIPE_OUT_MOUTH,
  REJECT_BIN,
  SCRAP_BIN,
  TRAP_CENTER,
  VIBE_BAR_T,
  VIBE_BAR_W,
  VIBE_BAR_Y,
  vibeBarLen,
  vibeBarZ,
  VIBE_X,
} from './stageLayout';

// 当たった瞬間に動かす部品の参照をまとめたもの。
export interface DrumPad {
  group: THREE.Group; // kick はこれ全体が膨らむ
  face: THREE.Mesh; // 打面（沈む）
  mat: THREE.MeshStandardMaterial;
  kick: boolean;
}
export interface VibeBar {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  restY: number;
}
export interface BassString {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  baseZ: number;
}
export interface Bell {
  group: THREE.Group; // 吊り下げ支点で揺らす
  mat: THREE.MeshStandardMaterial;
}
export interface Pipe {
  group: THREE.Group; // 反動で少し後ろへ
  ringMat: THREE.MeshStandardMaterial;
}
export interface Stage {
  group: THREE.Group;
  drums: DrumPad[];
  vibeBars: VibeBar[];
  bassStrings: BassString[];
  bells: Bell[];
  cymbal: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial };
  trapRimMat: THREE.MeshStandardMaterial;
  pipes: Pipe[]; // [フォロー内, フォロー外]
  scrapBin: THREE.Group;
  rejectBin: THREE.Group;
}

const metal = (color: string, roughness = 0.4): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness });
const dark = (color: string, roughness = 0.8): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness });

// 口の開いた箱。壁 4 枚と底で組む。
function openBin(mat: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const t = 0.07;
  const { w, h, d } = BIN_SIZE;
  const mk = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  mk(w, h, t, 0, h / 2, -d / 2 + t / 2);
  mk(w, h, t, 0, h / 2, d / 2 - t / 2);
  mk(t, h, d, -w / 2 + t / 2, h / 2, 0);
  mk(t, h, d, w / 2 - t / 2, h / 2, 0);
  mk(w, t, d, 0, t / 2, 0);
  return g;
}

// 上奥から曲がって降りてくる管。終端の接線はほぼ +x（楽器側）。
function buildPipe(mouth: { x: number; y: number; z: number }, color: string): Pipe {
  const g = new THREE.Group();
  const { x, y, z } = mouth;
  const dir = Math.sign(z) || 1; // 手前/奥どちらのパイプか
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x - 4.5, y + 5.5, z + dir * 3.5),
    new THREE.Vector3(x - 2.6, y + 3.4, z + dir * 2.4),
    new THREE.Vector3(x - 1.2, y + 1.5, z + dir * 1.1),
    new THREE.Vector3(x - 0.3, y + 0.25, z),
    new THREE.Vector3(x + 0.4, y, z),
  ]);
  const mat = metal(color, 0.35);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.3, 12), mat));
  // 口の光るリング（軸を x に向ける）
  const ringMat = new THREE.MeshStandardMaterial({
    color: '#151a24',
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.6,
    metalness: 0.5,
    roughness: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 10, 28), ringMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(x + 0.42, y, z);
  g.add(ring);
  return { group: g, ringMat };
}

// ドラムのパッド。打点（打面の中心）が group の原点に来るよう組む。
function buildDrumPad(i: number): DrumPad {
  const hit = DRUM_HITS[i];
  const kick = i === 0;
  const g = new THREE.Group();
  g.position.set(hit.x, hit.y, hit.z);
  // 打面を少しカメラ側（+z）と左（-x）へ傾ける
  g.rotation.set(0.28, 0, 0.22);
  const r = kick ? 0.62 : i === 4 ? 0.36 : 0.44;
  const depth = kick ? 0.6 : 0.26;
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.92, depth, 20),
    dark(kick ? '#5a4436' : '#3c3f48'),
  );
  shell.position.y = -depth / 2;
  g.add(shell);
  const mat = new THREE.MeshStandardMaterial({
    color: '#a8a296',
    emissive: new THREE.Color('#ffd9a0'),
    emissiveIntensity: 0,
    metalness: 0.1,
    roughness: 0.7,
  });
  const face = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.06, 20), mat);
  face.position.y = -0.03;
  g.add(face);
  // 床からの脚
  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, hit.y - depth, 8),
    dark('#2a2d34'),
  );
  leg.position.y = -(hit.y - depth) / 2 - depth / 2;
  g.add(leg);
  return { group: g, face, mat, kick };
}

// じょうご（落とし穴）。開いた円錐＋縁のリング。
function buildTrap(): { group: THREE.Group; rimMat: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.62, 0.9, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: '#33363f',
      metalness: 0.7,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  cone.rotation.x = Math.PI; // 頂点を下に
  cone.position.set(TRAP_CENTER.x, TRAP_CENTER.y, TRAP_CENTER.z);
  g.add(cone);
  const rimMat = new THREE.MeshStandardMaterial({
    color: '#22242c',
    emissive: new THREE.Color('#e8b04a'),
    emissiveIntensity: 0.2,
    metalness: 0.6,
    roughness: 0.5,
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 32), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(TRAP_CENTER.x, TRAP_CENTER.y + 0.45, TRAP_CENTER.z);
  g.add(rim);
  return { group: g, rimMat };
}

// エージェントの受け皿（椀）＋柱＋台座。group の原点は受け皿の中心。
export function buildBowl(): { group: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const profile = [
    new THREE.Vector2(0.01, -0.05),
    new THREE.Vector2(0.14, -0.02),
    new THREE.Vector2(0.3, 0.08),
    new THREE.Vector2(0.38, 0.2),
    new THREE.Vector2(0.4, 0.28),
  ];
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    metalness: 0.35,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 24), mat));
  const stand = dark('#23262e');
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.62, 8), stand);
  stem.position.y = -0.4;
  g.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 16), stand);
  foot.position.y = -0.74;
  g.add(foot);
  return { group: g, mat };
}

// 床・地区・楽器をまとめて作る。返す Stage の各部品は renderer が pulse で動かす。
export function buildStage(): Stage {
  const group = new THREE.Group();

  // 暗い床（ほんの少しだけ照明を拾う）
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(32, 32, 0.1, 64),
    new THREE.MeshStandardMaterial({
      color: '#161a26',
      metalness: 0.6,
      roughness: 0.42,
    }),
  );
  floor.position.y = -0.05;
  group.add(floor);

  // 話題の地区（床に光る円盤＋縁のリング）
  for (let i = 0; i < TOPICS.length; i++) {
    const p = districtPos(i, TOPICS.length);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(DISTRICT_DISC_R, 40),
      new THREE.MeshStandardMaterial({
        color: '#0d1018',
        emissive: new THREE.Color(TOPICS[i].color),
        emissiveIntensity: 0.5,
        roughness: 0.8,
        metalness: 0.2,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x, 0.02, p.z);
    group.add(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(DISTRICT_DISC_R, 0.025, 8, 48),
      new THREE.MeshBasicMaterial({ color: TOPICS[i].color }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.03, p.z);
    group.add(ring);
  }

  // 発射パイプ
  const pipes = [
    buildPipe(PIPE_IN_MOUTH, PIPE_IN_COLOR),
    buildPipe(PIPE_OUT_MOUTH, PIPE_OUT_COLOR),
  ];
  for (const p of pipes) group.add(p.group);

  // フィルタのドラム
  const drums = DRUM_HITS.map((_, i) => buildDrumPad(i));
  for (const d of drums) group.add(d.group);

  // 除外シンバル（薄い円盤。赤みのある真鍮）
  const cymbalMat = new THREE.MeshStandardMaterial({
    color: '#b56a45',
    emissive: new THREE.Color('#e24b4a'),
    emissiveIntensity: 0,
    metalness: 0.8,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
  const cymbalProfile = [
    new THREE.Vector2(0.04, 0.12),
    new THREE.Vector2(0.18, 0.09),
    new THREE.Vector2(0.5, 0.02),
    new THREE.Vector2(0.72, 0),
  ];
  const cymbal = new THREE.Mesh(new THREE.LatheGeometry(cymbalProfile, 32), cymbalMat);
  cymbal.position.set(CYMBAL_POS.x, CYMBAL_POS.y, CYMBAL_POS.z);
  cymbal.rotation.x = 0.45;
  group.add(cymbal);
  const cymbalPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, CYMBAL_POS.y, 8),
    dark('#2a2d34'),
  );
  cymbalPole.position.set(CYMBAL_POS.x, CYMBAL_POS.y / 2, CYMBAL_POS.z);
  group.add(cymbalPole);

  // スクラップ箱 / 落選箱
  const scrapBin = openBin(dark('#6b4a38'));
  scrapBin.position.set(SCRAP_BIN.x, 0, SCRAP_BIN.z);
  group.add(scrapBin);
  const rejectBin = openBin(dark('#3f4652'));
  rejectBin.position.set(REJECT_BIN.x, 0, REJECT_BIN.z);
  group.add(rejectBin);

  // ビブラフォン（鍵盤は z 方向に並び、低い音ほど長い。下に共鳴管）
  const vibeBars: VibeBar[] = [];
  const railMat = dark('#3a3d46');
  for (const zSide of [-3.55, 3.55]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.14), railMat);
    rail.position.set(VIBE_X, VIBE_BAR_Y - 0.14, zSide);
    group.add(rail);
  }
  for (const xSide of [-0.85, 0.85]) {
    for (const zSide of [-3.55, 3.55]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, VIBE_BAR_Y - 0.18, 8),
        railMat,
      );
      leg.position.set(VIBE_X + xSide, (VIBE_BAR_Y - 0.18) / 2, zSide);
      group.add(leg);
    }
  }
  for (let i = 0; i < VIBE_FREQS.length; i++) {
    const z = vibeBarZ(i);
    const len = vibeBarLen(i);
    const c = new THREE.Color().setHSL(0.12 + i * 0.016, 0.55, 0.55);
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      emissive: c.clone(),
      emissiveIntensity: 0,
      metalness: 0.9,
      roughness: 0.3,
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, VIBE_BAR_T, VIBE_BAR_W), mat);
    bar.position.set(VIBE_X, VIBE_BAR_Y - VIBE_BAR_T / 2, z);
    group.add(bar);
    vibeBars.push({ mesh: bar, mat, restY: bar.position.y });
    // 共鳴管（高い音ほど短い）
    const tubeLen = 1.1 - i * 0.07;
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, tubeLen, 10, 1, true),
      dark('#8a8f9c', 0.4),
    );
    tube.position.set(VIBE_X, VIBE_BAR_Y - 0.2 - tubeLen / 2, z);
    group.add(tube);
  }

  // ベース弦（枠に張った細い円柱 4 本）
  const bassStrings: BassString[] = [];
  const frameMat = dark('#6a4a30', 0.6);
  const stringLen = BASS_STRING_X1 - BASS_STRING_X0;
  const midX = (BASS_STRING_X0 + BASS_STRING_X1) / 2;
  // 弦の両端を支える低い駒。ボールは上から落ちてくるので、上は塞がない
  const bridgeH = BASS_Y + 0.12;
  for (const xSide of [BASS_STRING_X0 - 0.07, BASS_STRING_X1 + 0.07]) {
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, bridgeH, 3.4), frameMat);
    bridge.position.set(xSide, bridgeH / 2, 0);
    group.add(bridge);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(stringLen, 0.5, 3.0), frameMat);
  body.position.set(midX, BASS_Y - 0.55, 0);
  group.add(body);
  for (let i = 0; i < BASS_STRING_ZS.length; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: '#cfd2da',
      emissive: new THREE.Color('#bcd2ff'),
      emissiveIntensity: 0,
      metalness: 0.9,
      roughness: 0.25,
    });
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, stringLen, 8), mat);
    s.rotation.z = Math.PI / 2;
    s.position.set(midX, BASS_Y, BASS_STRING_ZS[i]);
    group.add(s);
    bassStrings.push({ mesh: s, mat, baseZ: BASS_STRING_ZS[i] });
  }

  // ベル 3 つ（金・銀・銅 = 1〜3 位）。横梁から吊り下げる
  const bells: Bell[] = [];
  const bellBeam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4.6), dark('#3a3d46'));
  bellBeam.position.set(BELL_X, BELL_Y + 1.0, 0);
  group.add(bellBeam);
  for (const zSide of [-2.2, 2.2]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, BELL_Y + 1.0, 8),
      dark('#3a3d46'),
    );
    post.position.set(BELL_X, (BELL_Y + 1.0) / 2, zSide);
    group.add(post);
  }
  const bellProfile = [
    new THREE.Vector2(0.02, 0.42),
    new THREE.Vector2(0.16, 0.4),
    new THREE.Vector2(0.28, 0.32),
    new THREE.Vector2(0.35, 0.18),
    new THREE.Vector2(0.4, 0.02),
    new THREE.Vector2(0.42, -0.04),
  ];
  for (let i = 0; i < BELL_ZS.length; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(BELL_X, BELL_Y + 1.0, BELL_ZS[i]);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), dark('#2a2d34'));
    rod.position.y = -0.25;
    pivot.add(rod);
    const mat = new THREE.MeshStandardMaterial({
      color: BELL_COLORS[i],
      emissive: new THREE.Color(BELL_COLORS[i]),
      emissiveIntensity: 0,
      metalness: 0.9,
      roughness: 0.3,
      side: THREE.DoubleSide,
    });
    const bell = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 24), mat);
    bell.position.y = -0.86;
    pivot.add(bell);
    group.add(pivot);
    bells.push({ group: pivot, mat });
  }

  const trap = buildTrap();
  group.add(trap.group);

  return {
    group,
    drums,
    vibeBars,
    bassStrings,
    bells,
    cymbal: { mesh: cymbal, mat: cymbalMat },
    trapRimMat: trap.rimMat,
    pipes,
    scrapBin,
    rejectBin,
  };
}
