// ステージの描画。真横から見た平面の図形だけで描き、画面全体が拍で動く。
// 当たる瞬間は show/score.ts の時刻表と一致する（音は audio/ が同じ時刻表から鳴らす）。
// DOM / WebGL に触れるのはこのファイルだけ（と instruments.ts のメッシュ生成）。
import * as THREE from 'three';
import { FEED_KEEP, MAX_AGENT_COUNT, TOPICS } from '../sim/config';
import type { BeatEvents, Reactions, World } from '../sim/types';
import { timeline } from '../show/score';
import { createAgentMotion } from './agentMotion';
import { interestTint } from './agentLook';
import {
  ANTICIP,
  buildAgent,
  buildStage,
  buildTourLine,
  INK,
  PAPER,
  REST,
  TOUR_JAW_W,
} from './instruments';
import { TOUR_X_DIVERSITY, TOUR_X_REJECT, TOUR_X_SCRAP } from '../show/tour';
import {
  AGENT_R,
  BIN_SIZE,
  clamp01,
  DISTRICT_CENTER,
  DISTRICT_DISC_R,
  districtPos,
  hash01,
  PIPE_IN_MOUTH,
  PIPE_OUT_MOUTH,
  TOUR_BIN_TOP_Y,
  VIEW_RECT,
  type P3,
} from './stageLayout';
import { ballState, TAIL_DT, TAIL_STEPS, type BallState } from './trajectory';
import { tourMachines } from './tourMotion';
import './stage.css';

export interface Renderer {
  // world を作り直したとき（起動時・リセット時）に呼ぶ。演出とエージェントの位置を初期化する。
  reset(world: World): void;
  // stepBeat の直後に、その戻り値を渡して呼ぶ。
  onBeat(world: World, events: BeatEvents): void;
  // 毎フレーム呼ぶ。beat は小数のビート位置、dt は前フレームからの秒数（一時停止中は 0）。
  draw(world: World, beat: number, dt: number): void;
  // 画面座標（clientX, clientY）にいるエージェントの id。いなければ null。
  hitTestAgent(clientX: number, clientY: number): number | null;
  setSelectedAgent(agentId: number | null): void;
  // 画面に収める範囲を変える（発表の進行でカメラを楽器に寄せる）。null で全体に戻す。
  // 切り替えは滑らかに動く。
  setView(rect: ViewRect | null): void;
  // 工程の紹介（下の階のベルトコンベア）を表示するか。reset では変わらない。
  setTour(on: boolean): void;
}

export interface ViewRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const BALL_CAP = 256; // 同時に出るボールの上限。超えた分は描かない
const CROSS_CAP = BALL_CAP * 2; // × の印はボール 1 個につき矩形 2 本
const SPARK_CAP = MAX_AGENT_COUNT * 8 + 64;
const DOT_CAP = MAX_AGENT_COUNT * FEED_KEEP;
const PULSE_BEATS = 0.5; // 当たったあとの発光が消えるまでの拍数
const ANTICIP_BEATS = 0.5; // 当たる前に予告の光が入る拍数
const ANTICIP_KINDS = new Set(['drum', 'vibe', 'bass', 'bell', 'cymbal', 'trap']);
const FEED_DOT_R = 0.74; // フィードの粒が並ぶ半径

// 奥行き（z）は重なり順だけを決める。
const Z_AGENT = 0.5;
const Z_FEED_DOT = 0.55;
const Z_SEL_RING = 0.6;
const Z_BALL = 1;
const Z_CROSS = 1.05; // 落とされたボールに重ねる × の印
const Z_SPARK = 1.2;

// VIEW_RECT をカメラに収める（contain）
const VIEW_W = VIEW_RECT.x1 - VIEW_RECT.x0;
const VIEW_H = VIEW_RECT.y1 - VIEW_RECT.y0;
const VIEW_CX = (VIEW_RECT.x0 + VIEW_RECT.x1) / 2;
const VIEW_CY = (VIEW_RECT.y0 + VIEW_RECT.y1) / 2;

const BG0 = new THREE.Color('#ffffff');
const BG1 = new THREE.Color('#f4f4f4');
const REST_C = new THREE.Color(REST);
const PAPER_C = new THREE.Color(PAPER);
const INK_C = new THREE.Color(INK);
const ANTICIP_C = new THREE.Color(ANTICIP);
const DIM_LINE_C = new THREE.Color('#cfcfcf'); // dim 時のエージェントの輪郭
const TOPIC_COLORS = TOPICS.map((t) => new THREE.Color(t.color));

interface PendingDelivery {
  at: number; // 演出を始めるビート位置（その候補の catch の時刻）
  agentId: number;
  topic: number;
  reactions: Reactions;
  followed: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  color: THREE.Color;
}

interface Label {
  el: HTMLElement;
  anchor: () => P3 | null; // null は隠す
}

const noopRenderer: Renderer = {
  reset() {},
  onBeat() {},
  draw() {},
  hitTestAgent: () => null,
  setSelectedAgent() {},
  setView() {},
  setTour() {},
};

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  // ラベル用の DOM レイヤー。canvas の親いっぱいに広げる。
  const parent = canvas.parentElement;
  const labelLayer = document.createElement('div');
  labelLayer.className = 'stage-labels';
  if (parent) {
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(labelLayer);
  }

  let gl: THREE.WebGLRenderer;
  try {
    gl = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    const msg = document.createElement('div');
    msg.className = 'stage-no-webgl';
    msg.textContent = 'WebGL が使えないため表示できません';
    labelLayer.appendChild(msg);
    return noopRenderer;
  }
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const bgColor = new THREE.Color().copy(BG0);
  scene.background = bgColor;

  // 真横固定の OrthographicCamera。VIEW_RECT 全体が必ず収まるようにする。
  const camera = new THREE.OrthographicCamera(-VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 0.1, 200);
  camera.position.set(VIEW_CX, VIEW_CY, 50);
  camera.lookAt(VIEW_CX, VIEW_CY, 0);

  const stage = buildStage();
  scene.add(stage.group);

  // 工程の紹介のベルトコンベア（下の階）。紹介の場面だけ表示する
  const tourLine = buildTourLine();
  tourLine.group.visible = false;
  scene.add(tourLine.group);
  let tourOn = false;

  // ボールと尾は 2 つの InstancedMesh で描く（塗りつぶした円と、フォロー外用の輪）
  const ballCap = BALL_CAP * (1 + TAIL_STEPS);
  const ballMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ballCap,
  );
  ballMesh.count = 0;
  ballMesh.frustumCulled = false;
  scene.add(ballMesh);
  const ballRingMesh = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.62, 1, 24),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ballCap,
  );
  ballRingMesh.count = 0;
  ballRingMesh.frustumCulled = false;
  scene.add(ballRingMesh);

  // 落とされたボールに重ねる × の印（細い矩形 2 本を ±45° で重ねる）
  const crossMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    CROSS_CAP,
  );
  crossMesh.count = 0;
  crossMesh.frustumCulled = false;
  scene.add(crossMesh);

  // 配信の火花（平面の小さな円）
  const sparkMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 10),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    SPARK_CAP,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  // エージェントの円のまわりに並ぶフィードの粒（全エージェント分を 1 つの InstancedMesh で）
  const dotMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 10),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    DOT_CAP,
  );
  dotMesh.count = 0;
  dotMesh.frustumCulled = false;
  scene.add(dotMesh);
  const dotWhite = new THREE.Color('#ffffff');
  for (let i = 0; i < DOT_CAP; i++) dotMesh.setColorAt(i, dotWhite);

  // エージェントの円（最大数だけ作り置きして表示数を変える）
  const agents: { group: THREE.Group; mat: THREE.MeshBasicMaterial }[] = [];
  for (let i = 0; i < MAX_AGENT_COUNT; i++) {
    const a = buildAgent();
    a.group.visible = false;
    scene.add(a.group);
    agents.push(a);
  }
  // 選択中のエージェントを囲む黒い輪
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1.0, 48),
    new THREE.MeshBasicMaterial({ color: INK }),
  );
  selRing.visible = false;
  scene.add(selRing);

  const motion = createAgentMotion();
  const sparks: Spark[] = [];
  const pending: PendingDelivery[] = [];
  const labels: Label[] = [];
  const agentLabels: HTMLElement[] = [];
  let selectedId: number | null = null;
  let timeSec = 0;
  // 箱に落ちたボールの累計（ラベルに出す）。reset で 0 に戻す
  let scrapCount = 0;
  let rejectCount = 0;
  // キー（kind:index）ごとの、当たりの強さとそれを出したボールの話題の色
  const pulseMap = new Map<string, { p: number; color: THREE.Color }>();
  const anticipMap = new Map<string, number>();

  // --- ラベル ---
  function addLabel(main: string, anchor: () => P3 | null, cls = ''): HTMLElement {
    const el = document.createElement('div');
    el.className = `stage-label ${cls}`;
    el.textContent = main;
    labelLayer.appendChild(el);
    labels.push({ el, anchor });
    return el;
  }

  // 工程名。パイプの 2 つは口の少し上、ほかは床の下に横一列。
  addLabel('フォロー内', () => ({ x: -15.6, y: PIPE_IN_MOUTH.y + 1.0, z: 0 }));
  addLabel('フォロー外', () => ({ x: -15.6, y: PIPE_OUT_MOUTH.y + 1.0, z: 0 }));
  addLabel('フィルタ', () => ({ x: -9.8, y: -1.0, z: 0 }));
  addLabel('スコアリング', () => ({ x: 0, y: -1.0, z: 0 }));
  addLabel('多様性調整', () => ({ x: 7.15, y: -1.0, z: 0 }));
  addLabel('選抜', () => ({ x: 14.4, y: -1.0, z: 0 }));
  const scrapLabel = addLabel('除外 0', () => ({ x: -5.2, y: -1.0, z: 0 }), 'count');
  const rejectLabel = addLabel('落選 0', () => ({ x: 11.0, y: -1.0, z: 0 }), 'count');
  // 工程の紹介の下の階の箱の下に出す個数ラベル（紹介の場面だけ表示）
  const tourScrapLabel = addLabel(
    '除外 0',
    () =>
      tourOn
        ? { x: TOUR_X_SCRAP, y: TOUR_BIN_TOP_Y - BIN_SIZE.h - 0.5, z: 0 }
        : null,
    'count',
  );
  const tourRejectLabel = addLabel(
    '落選 0',
    () =>
      tourOn
        ? { x: TOUR_X_REJECT, y: TOUR_BIN_TOP_Y - BIN_SIZE.h - 0.5, z: 0 }
        : null,
    'count',
  );
  TOPICS.forEach((t, i) => {
    // 街の中心から見て外向きに、地区の円の縁から 0.6 離す
    const el = addLabel(
      t.name,
      () => {
        const p = districtPos(i, TOPICS.length);
        const dx = p.x - DISTRICT_CENTER.x;
        const dy = p.y - DISTRICT_CENTER.y;
        const d = Math.hypot(dx, dy) || 1;
        return {
          x: p.x + (dx / d) * (DISTRICT_DISC_R + 0.6),
          y: p.y + (dy / d) * (DISTRICT_DISC_R + 0.6),
          z: 0,
        };
      },
      'topic',
    );
    el.style.color = t.color;
  });

  const STATIC_LABELS = labels.length;

  function rebuildAgentLabels(world: World): void {
    for (const el of agentLabels) el.remove();
    agentLabels.length = 0;
    labels.length = STATIC_LABELS;
    world.agents.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'stage-label agent';
      el.textContent = a.name;
      labelLayer.appendChild(el);
      agentLabels.push(el);
      // エージェント名は選択中のものだけ出す（円の下）
      labels.push({ el, anchor: () => (i === selectedId ? agentAnchor(i) : null) });
    });
  }

  // --- 小物 ---
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  function setInstance(
    mesh: THREE.InstancedMesh,
    i: number,
    p: P3,
    sx: number,
    sy: number,
    c: THREE.Color,
    rot = 0, // z 軸まわりの回転（ラジアン）
  ) {
    tmpV.set(p.x, p.y, p.z);
    tmpQ.setFromAxisAngle(Z_AXIS, rot);
    tmpS.set(Math.max(sx, 1e-4), Math.max(sy, 1e-4), 1);
    tmpM.compose(tmpV, tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);
    mesh.setColorAt(i, c);
  }

  // エージェントの円の今の位置（catch のパルスで沈む分も込み）。
  // ボールの終点とラベル・ヒットテストが使う。
  function agentPos(i: number): P3 {
    const s = motion.pos(i);
    const p = pulseMap.get(`catch:${i}`)?.p ?? 0;
    if (!s) return { x: DISTRICT_CENTER.x, y: DISTRICT_CENTER.y, z: 0 };
    return { x: s.x, y: s.y + s.hop - p * 0.18, z: 0 };
  }

  function agentAnchor(i: number): P3 | null {
    if (i >= motion.count()) return null;
    const p = agentPos(i);
    return { x: p.x, y: p.y - AGENT_R - 0.35, z: p.z };
  }

  // ワールド座標 → canvas 内の CSS ピクセル。カメラの後ろなら null。
  function toScreen(p: P3): { x: number; y: number } | null {
    tmpV.set(p.x, p.y, p.z).project(camera);
    if (tmpV.z > 1 || tmpV.z < -1) return null;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return { x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h };
  }

  // ラベルレイヤー内の座標（canvas は親の中でパディング分ずれている）
  function toLabelPos(p: P3): { x: number; y: number } | null {
    const s = toScreen(p);
    if (!s) return null;
    return { x: s.x + canvas.offsetLeft, y: s.y + canvas.offsetTop };
  }

  function placeLabels(): void {
    for (const l of labels) {
      const a = l.anchor();
      const s = a && toLabelPos(a);
      if (!s) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = '';
      l.el.style.transform = `translate(-50%, -50%) translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  }

  function spawnReactIcon(kind: string, text: string, p: { x: number; y: number }, slot: number, color: string): void {
    const el = document.createElement('div');
    el.className = `stage-react ${kind}`;
    el.textContent = text;
    el.style.color = color;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.setProperty('--dx', `${(slot - 1.5) * 26}px`);
    el.addEventListener('animationend', () => el.remove());
    labelLayer.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // 配信の演出（エージェントの円に届いた瞬間）。火花 + 反応アイコン + 円の弾み。
  function fireDelivery(d: PendingDelivery): void {
    const p = agentPos(d.agentId);
    const col = TOPICS[d.topic].color;
    const nR =
      (d.reactions.like ? 1 : 0) + (d.reactions.reply ? 1 : 0) + (d.reactions.repost ? 1 : 0);
    motion.kick(d.agentId, 1.2 + 0.9 * nR);
    const seed = d.agentId * 31 + d.at * 7;
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2 + hash01(seed + j) * 0.6;
      const sp = 1.4 + 1.8 * hash01(j * 13 + d.agentId);
      sparks.push({
        x: p.x,
        y: p.y + 0.1,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp + 1.2,
        age: 0,
        ttl: 0.5,
        color: new THREE.Color(col),
      });
    }
    const s = toLabelPos(p);
    if (s) {
      let slot = 0;
      if (d.reactions.like) spawnReactIcon('like', '♥', s, slot++, '#111111');
      if (d.reactions.reply) spawnReactIcon('reply', '…', s, slot++, '#111111');
      if (d.reactions.repost) spawnReactIcon('repost', '↻', s, slot++, '#111111');
      if (d.followed) spawnReactIcon('follow', '+フォロー', s, slot++, '#777777');
    }
  }

  // --- サイズとカメラの範囲 ---
  const FULL_VIEW = { cx: VIEW_CX, cy: VIEW_CY, w: VIEW_W, h: VIEW_H };
  const view = { ...FULL_VIEW }; // 今の範囲
  let viewTarget = { ...FULL_VIEW }; // 向かう先
  const VIEW_SPEED = 3.2; // 大きいほど速く寄る

  function stepView(dt: number): void {
    const k = 1 - Math.exp(-dt * VIEW_SPEED);
    view.cx += (viewTarget.cx - view.cx) * k;
    view.cy += (viewTarget.cy - view.cy) * k;
    view.w += (viewTarget.w - view.w) * k;
    view.h += (viewTarget.h - view.h) * k;
    applyView();
  }

  function applySize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    gl.setSize(w, h, false);
    applyView();
  }

  // 今の view（中心と幅・高さ）がちょうど収まるようにカメラを合わせる。
  function applyView(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    const halfW = Math.max(view.w / 2, (view.h / 2) * aspect);
    const halfH = halfW / aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.position.x = view.cx;
    camera.position.y = view.cy;
    camera.updateProjectionMatrix();
  }

  applySize();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(applySize).observe(canvas);
  }

  function drawBalls(world: World, beat: number): void {
    let nf = 0; // 塗りつぶし
    let nh = 0; // 輪（フォロー外）
    let nx = 0; // × の印
    let pale = 1;
    const put = (s: BallState, tailFade: number) => {
      const r = s.radius * tailFade;
      // 白い背景では薄くなるほど紙の白へ近づける
      const f = clamp01(pale * tailFade * tailFade * Math.max(0, s.opacity));
      tmpC.set(s.color).lerp(PAPER_C, 1 - f);
      const mesh = s.hollow ? ballRingMesh : ballMesh;
      const i = s.hollow ? nh++ : nf++;
      setInstance(
        mesh,
        i,
        { x: s.pos.x, y: s.pos.y, z: Z_BALL },
        r * (1 + 0.35 * s.squash),
        r * (1 - 0.35 * s.squash),
        tmpC,
      );
    };
    for (const c of world.candidates) {
      if (nf + nh >= ballCap) break;
      const ap = agentPos(c.agentId);
      const st = ballState(c, beat, ap);
      if (!st.visible) continue;
      pale = selectedId !== null && c.agentId !== selectedId ? 0.3 : 1;
      // 頭と尾。尾は少し前の時刻に評価した位置に、だんだん小さく薄くする
      put(st, 1);
      // 落とされたボール（頭だけ）に × を重ねる
      if (st.crossed && nx + 2 <= CROSS_CAP) {
        const len = st.radius * 2 * 1.3; // ボールの直径の 1.3 倍
        for (const rot of [Math.PI / 4, -Math.PI / 4]) {
          setInstance(
            crossMesh,
            nx++,
            { x: st.pos.x, y: st.pos.y, z: Z_CROSS },
            len,
            0.06,
            INK_C,
            rot,
          );
        }
      }
      // 尾は少し前の時刻に評価した位置に、だんだん小さく薄くする。紹介のボールは尾を描かない
      for (let k = 1; !c.tour && k <= TAIL_STEPS && nf + nh < ballCap; k++) {
        const ts = ballState(c, beat - k * TAIL_DT, ap);
        if (!ts.visible) break;
        put(ts, 1 - k / (TAIL_STEPS + 2));
      }
    }
    ballMesh.count = nf;
    ballMesh.instanceMatrix.needsUpdate = true;
    if (ballMesh.instanceColor) ballMesh.instanceColor.needsUpdate = true;
    ballRingMesh.count = nh;
    ballRingMesh.instanceMatrix.needsUpdate = true;
    if (ballRingMesh.instanceColor) ballRingMesh.instanceColor.needsUpdate = true;
    crossMesh.count = nx;
    crossMesh.instanceMatrix.needsUpdate = true;
    if (crossMesh.instanceColor) crossMesh.instanceColor.needsUpdate = true;
  }

  function drawSparks(dt: number): void {
    let n = 0;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age >= s.ttl) {
        sparks.splice(i, 1);
        continue;
      }
      s.vy -= 7 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (const s of sparks) {
      if (n >= SPARK_CAP) break;
      const f = 1 - s.age / s.ttl;
      const r = 0.07 * (0.4 + 0.6 * f);
      tmpC.copy(s.color).lerp(PAPER_C, 1 - f);
      setInstance(sparkMesh, n++, { x: s.x, y: s.y, z: Z_SPARK }, r, r, tmpC);
    }
    sparkMesh.count = n;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
  }

  function drawAgents(world: World): void {
    const n = world.agents.length;
    let d = 0;
    for (let i = 0; i < n && i < agents.length; i++) {
      const s = motion.pos(i);
      const a = agents[i];
      if (!s) {
        a.group.visible = false;
        continue;
      }
      const dim = selectedId !== null && i !== selectedId;
      const p = agentPos(i);
      a.group.visible = true;
      a.group.position.set(p.x, p.y, Z_AGENT);
      a.group.scale.setScalar((dim ? 0.75 : 1) * (1 + s.pop * 0.25));
      // 円の色は興味の偏りで染まる（最初は全員白）。選択でないものは白へ寄せる
      const tint = interestTint(world.agents[i].interest);
      a.mat.color
        .copy(PAPER_C)
        .lerp(TOPIC_COLORS[tint.topic], tint.amount)
        .lerp(PAPER_C, dim ? 0.7 : 0);
      const outline = a.group.userData.outlineMat as THREE.MeshBasicMaterial | undefined;
      if (outline) outline.color.copy(dim ? DIM_LINE_C : INK_C);
      // フィードの話題構成を円のまわりの粒で示す（足りない分は空の粒）
      const feed = world.agents[i].feed;
      for (let k = 0; k < FEED_KEEP && d < DOT_CAP; k++, d++) {
        const ang = (k / FEED_KEEP) * Math.PI * 2 - Math.PI / 2;
        const item = feed[k];
        tmpC.set(item ? TOPICS[item.topic].color : '#e2e2e2').lerp(PAPER_C, dim ? 0.7 : 0);
        setInstance(
          dotMesh,
          d,
          {
            x: p.x + Math.cos(ang) * FEED_DOT_R,
            y: p.y + Math.sin(ang) * FEED_DOT_R,
            z: Z_FEED_DOT,
          },
          0.07,
          0.07,
          tmpC,
        );
      }
    }
    dotMesh.count = d;
    dotMesh.instanceMatrix.needsUpdate = true;
    if (dotMesh.instanceColor) dotMesh.instanceColor.needsUpdate = true;
    for (let i = n; i < agents.length; i++) agents[i].group.visible = false;
    if (selectedId !== null && selectedId < n) {
      const p = agentPos(selectedId);
      selRing.visible = true;
      selRing.position.set(p.x, p.y, Z_SEL_RING);
    } else {
      selRing.visible = false;
    }
  }

  // 当たった瞬間の発光と動き。楽器ごとの「最後に当たってからの拍数」から決める。
  // 当たる直前の ANTICIP_BEATS 拍のあいだは予告として少し色を置く。
  function applyPulses(world: World, beat: number): void {
    pulseMap.clear();
    anticipMap.clear();
    for (const c of world.candidates) {
      for (const h of timeline(c)) {
        const age = beat - h.time;
        const key = `${h.kind}:${h.index}`;
        if (age >= 0 && age <= PULSE_BEATS) {
          const p = 1 - age / PULSE_BEATS;
          // 一番強い pulse を出したボールの話題の色を覚える
          if (p > (pulseMap.get(key)?.p ?? 0))
            pulseMap.set(key, { p, color: TOPIC_COLORS[c.topic] });
        } else if (age >= -ANTICIP_BEATS && age < 0 && ANTICIP_KINDS.has(h.kind)) {
          const a = 1 + age / ANTICIP_BEATS;
          if (a > (anticipMap.get(key) ?? 0)) anticipMap.set(key, a);
        }
      }
    }
    const entry = (kind: string, i = 0) => pulseMap.get(`${kind}:${i}`);
    const pulse = (kind: string, i = 0) => entry(kind, i)?.p ?? 0;
    const anticip = (kind: string, i = 0) => anticipMap.get(`${kind}:${i}`) ?? 0;
    // 塗りを持つ部品: 予告は薄い灰、当たった瞬間はそのボールの話題の色で塗る
    const glowFill = (mat: THREE.MeshBasicMaterial, kind: string, i = 0) => {
      mat.color.copy(PAPER_C).lerp(ANTICIP_C, 0.9 * anticip(kind, i));
      const e = entry(kind, i);
      if (e) mat.color.lerp(e.color, e.p);
    };
    // 線だけの部品: 灰色から黒へ
    const glowLine = (mat: THREE.MeshBasicMaterial, kind: string, i = 0) => {
      mat.color.copy(REST_C).lerp(INK_C, clamp01(0.35 * anticip(kind, i) + pulse(kind, i)));
    };

    stage.drums.forEach((d, i) => {
      const p = pulse('drum', i);
      glowFill(d.mat, 'drum', i);
      d.group.scale.setScalar(1 + (d.kick ? 0.18 : 0.08) * p);
    });
    stage.vibeBars.forEach((b, i) => {
      const p = pulse('vibe', i);
      glowFill(b.mat, 'vibe', i);
      b.mesh.position.y = b.restY - 0.07 * p;
    });
    stage.bassStrings.forEach((s, i) => {
      const p = pulse('bass', i);
      glowLine(s.mat, 'bass', i);
      s.mesh.position.y = s.restY + Math.sin(timeSec * 55 + i * 2.1) * 0.09 * p;
    });
    stage.bells.forEach((b, i) => {
      const p = pulse('bell', i);
      glowFill(b.mat, 'bell', i);
      b.mesh.scale.setScalar(1 + 0.2 * p);
    });
    // プレス機: 直前に少し振りかぶり、当たった瞬間にヘッドが打点まで降りてから戻る。
    // ヘッドは話題の色ではなく黒く光る（落とす機械は色を持たない）。
    const cp = pulse('cymbal');
    stage.press.group.position.y = stage.press.restY - 0.9 * cp + 0.25 * anticip('cymbal');
    stage.press.headMat.color.copy(PAPER_C).lerp(INK_C, cp);
    // 落選の扉: 当たった瞬間に開ききっていて、そこから閉じていく
    stage.trapDoor.hinge.rotation.z = -1.35 * pulse('trap');
    stage.scrapBin.position.y = -0.09 * pulse('scrap');
    stage.rejectBin.position.y = -0.09 * pulse('reject');
    stage.pipes.forEach((pipe, i) => {
      const p = pulse('launch', i);
      pipe.group.position.x = -0.3 * p;
      glowFill(pipe.ringMat, 'launch', i);
    });
    // キックの拍でわずかにズーム
    camera.zoom = 1 + 0.015 * pulse('drum', 0);
    camera.updateProjectionMatrix();
  }

  // 工程の紹介のベルトコンベアの機械を、ボールの時刻に合わせて動かす。
  // tourLine が隠れている間は何もしない。
  function applyTourMachines(world: World, beat: number): void {
    if (!tourOn) return;
    const tm = tourMachines(world.candidates, beat);
    // プレス: 当たった瞬間にボールの上端まで降りる。除外のボールに当たるとヘッドが黒くなる
    tourLine.press.group.position.y = tourLine.press.restY - tourLine.press.travel * tm.press;
    tourLine.press.headMat.color.copy(PAPER_C).lerp(INK_C, tm.pressInk);
    // 扉: ボールが着いた瞬間に開ききってから閉じていく
    tourLine.scrapDoor.hinge.rotation.z = -1.35 * tm.scrapDoor;
    tourLine.rejectDoor.hinge.rotation.z = -1.35 * tm.rejectDoor;
    // 計器: 下からスコアの高さまで伸びる。色は計っているボールの話題の色
    tourLine.gauge.fill.scale.y = Math.max(tm.gauge, 0.001);
    tourLine.gauge.fillMat.color.copy(
      tm.gaugeTopic === null ? PAPER_C : TOPIC_COLORS[tm.gaugeTopic],
    );
    // しぼり機: 左右の板がボールの半径まで閉じる
    tourLine.jaws.left.position.x = TOUR_X_DIVERSITY - tm.jawGap - TOUR_JAW_W / 2;
    tourLine.jaws.right.position.x = TOUR_X_DIVERSITY + tm.jawGap + TOUR_JAW_W / 2;
    // ベル: 鳴った瞬間に話題の色で膨らむ
    tourLine.bell.mesh.scale.setScalar(1 + 0.2 * tm.bell);
    tourLine.bell.mat.color.copy(PAPER_C);
    if (tm.bellTopic !== null) {
      tourLine.bell.mat.color.lerp(TOPIC_COLORS[tm.bellTopic], tm.bell);
    }
    // パイプ: ボールが出た反動で少し左へ
    tourLine.pipes[0].group.position.x = -0.3 * tm.pipeIn;
    tourLine.pipes[1].group.position.x = -0.3 * tm.pipeOut;
  }

  // 拍に合わせた背景の脈動。一時停止中は beat が進まないので止まる。
  function applyBeatPulse(beat: number): void {
    const frac = beat - Math.floor(beat);
    let beatPulse = Math.exp(-frac * 5);
    if (Math.floor(beat) % 4 === 0) beatPulse *= 1.6;
    for (const r of stage.bgRings) r.scale.setScalar(1 + 0.05 * beatPulse);
    bgColor.copy(BG0).lerp(BG1, Math.min(1, 0.6 * beatPulse));
  }

  return {
    reset(world) {
      if (selectedId !== null && selectedId >= world.agents.length) selectedId = null;
      motion.reset(world.agents.length);
      sparks.length = 0;
      pending.length = 0;
      rebuildAgentLabels(world);
      timeSec = 0;
      scrapCount = 0;
      rejectCount = 0;
      scrapLabel.textContent = '除外 0';
      rejectLabel.textContent = '落選 0';
      tourScrapLabel.textContent = '除外 0';
      tourRejectLabel.textContent = '落選 0';
    },
    onBeat(_world, events) {
      // 箱に落ちたボールを数えてラベルを更新する（dropStage 1 が除外、4 が落選）
      for (const c of events.dropped) {
        if (c.dropStage === 1) scrapCount++;
        else if (c.dropStage === 4) rejectCount++;
      }
      if (events.dropped.length > 0) {
        scrapLabel.textContent = `除外 ${scrapCount}`;
        rejectLabel.textContent = `落選 ${rejectCount}`;
        tourScrapLabel.textContent = `除外 ${scrapCount}`;
        tourRejectLabel.textContent = `落選 ${rejectCount}`;
      }
      for (const d of events.delivered) {
        // 届いた拍の stepBeat 時点ではなく、その候補の catch の時刻（拍の途中）に発火する
        const hit = timeline(d.candidate).find((h) => h.kind === 'catch');
        pending.push({
          at: hit ? hit.time : events.beat,
          agentId: d.candidate.agentId,
          topic: d.candidate.topic,
          reactions: d.item.reactions,
          followed: d.followed,
        });
      }
      motion.beatHop(events.beat);
    },
    draw(world, beat, dt) {
      timeSec += dt;
      if (motion.count() !== world.agents.length) {
        motion.reset(world.agents.length);
        rebuildAgentLabels(world);
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        if (beat >= pending[i].at) {
          fireDelivery(pending[i]);
          pending.splice(i, 1);
        }
      }
      motion.update(world, dt);
      stepView(dt);
      applyPulses(world, beat);
      applyBeatPulse(beat);
      applyTourMachines(world, beat);
      drawBalls(world, beat);
      drawSparks(dt);
      drawAgents(world);
      placeLabels();
      gl.render(scene, camera);
    },
    hitTestAgent(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      // エージェントの円が画面上で占める半径より少し大きいしきい値
      const pxPerUnit = rect.width / (camera.right - camera.left);
      let best = -1;
      let bestD = Math.max(24, AGENT_R * pxPerUnit * 1.4);
      for (let i = 0; i < motion.count(); i++) {
        const s = toScreen(agentPos(i));
        if (!s) continue;
        const d = Math.hypot(s.x - (clientX - rect.left), s.y - (clientY - rect.top));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 ? best : null;
    },
    setSelectedAgent(agentId) {
      selectedId = agentId;
    },
    setView(rect) {
      viewTarget = rect
        ? {
            cx: (rect.x0 + rect.x1) / 2,
            cy: (rect.y0 + rect.y1) / 2,
            w: rect.x1 - rect.x0,
            h: rect.y1 - rect.y0,
          }
        : { ...FULL_VIEW };
    },
    setTour(on) {
      tourOn = on;
      tourLine.group.visible = on;
    },
  };
}
