// ステージの描画。真横から見た平面の図形だけで描き、画面全体が拍で動く。
// 当たる瞬間は show/score.ts の時刻表と一致する（音は audio/ が同じ時刻表から鳴らす）。
// DOM / WebGL に触れるのはこのファイルだけ（と instruments.ts のメッシュ生成）。
import * as THREE from 'three';
import { FEED_KEEP, MAX_AGENT_COUNT, TOPICS } from '../sim/config';
import type { BeatEvents, Reactions, World } from '../sim/types';
import { timeline } from '../show/score';
import { createAgentMotion } from './agentMotion';
import { interestTint } from './agentLook';
import { buildAgent, buildStage, REST, WHITE } from './instruments';
import {
  AGENT_R,
  BELL_R,
  bellHit,
  clamp01,
  DISTRICT_CENTER,
  DISTRICT_DISC_R,
  districtPos,
  hash01,
  hitPoint,
  PIPE_IN_MOUTH,
  PIPE_OUT_MOUTH,
  VIEW_RECT,
  type P3,
} from './stageLayout';
import { ballState, TAIL_DT, TAIL_STEPS, type BallState } from './trajectory';
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
}

const BALL_CAP = 256; // 同時に出るボールの上限。超えた分は描かない
const SPARK_CAP = MAX_AGENT_COUNT * 8 + 64;
const DOT_CAP = MAX_AGENT_COUNT * FEED_KEEP;
const RIPPLE_CAP = 256; // 当たった瞬間の波紋の上限
const PULSE_BEATS = 0.5; // 当たったあとの発光が消えるまでの拍数
const ANTICIP_BEATS = 0.5; // 当たる前に予告の光が入る拍数
const ANTICIP_KINDS = new Set(['drum', 'vibe', 'bass', 'bell', 'cymbal', 'trap']);
const RIPPLE_BEATS = 0.6; // 波紋が広がって消えるまでの拍数
const RIPPLE_KINDS = new Set(['drum', 'vibe', 'bass', 'bell', 'cymbal', 'trap', 'catch']);

// 奥行き（z）は重なり順だけを決める。
const Z_AGENT = 0.5;
const Z_FEED_DOT = 0.55;
const Z_SEL_RING = 0.6;
const Z_RIPPLE = 0.9;
const Z_BALL = 1;
const Z_SPARK = 1.2;

// VIEW_RECT をカメラに収める（contain）
const VIEW_W = VIEW_RECT.x1 - VIEW_RECT.x0;
const VIEW_H = VIEW_RECT.y1 - VIEW_RECT.y0;
const VIEW_CX = (VIEW_RECT.x0 + VIEW_RECT.x1) / 2;
const VIEW_CY = (VIEW_RECT.y0 + VIEW_RECT.y1) / 2;

const BG0 = new THREE.Color('#06070b');
const BG1 = new THREE.Color('#0d0f16');
const REST_C = new THREE.Color(REST);
const WHITE_C = new THREE.Color(WHITE);
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

type LabelAlign = 'center' | 'left' | 'right';

interface Label {
  el: HTMLElement;
  anchor: () => P3 | null; // null は隠す
  align: LabelAlign; // アンカーの点を要素のどこに合わせるか
}

const noopRenderer: Renderer = {
  reset() {},
  onBeat() {},
  draw() {},
  hitTestAgent: () => null,
  setSelectedAgent() {},
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

  // 配信の火花（平面の小さな円）
  const sparkMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 10),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    SPARK_CAP,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  // エージェントの円のまわりを囲むフィードの輪（1 件ぶんの扇形を FEED_KEEP 個並べる。
  // 全エージェント分を 1 つの InstancedMesh で）
  const feedRingMesh = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.58, 0.72, 6, 1, 0, (Math.PI * 2) / FEED_KEEP),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    DOT_CAP,
  );
  feedRingMesh.count = 0;
  feedRingMesh.frustumCulled = false;
  scene.add(feedRingMesh);
  const dotWhite = new THREE.Color('#ffffff');
  for (let i = 0; i < DOT_CAP; i++) feedRingMesh.setColorAt(i, dotWhite);

  // 当たった瞬間に打点から広がる波紋（加算合成でじわっと光る）
  const rippleMesh = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.86, 1, 32),
    new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    RIPPLE_CAP,
  );
  rippleMesh.count = 0;
  rippleMesh.frustumCulled = false;
  scene.add(rippleMesh);

  // エージェントの円（最大数だけ作り置きして表示数を変える）
  const agents: { group: THREE.Group; mat: THREE.MeshBasicMaterial }[] = [];
  for (let i = 0; i < MAX_AGENT_COUNT; i++) {
    const a = buildAgent();
    a.group.visible = false;
    scene.add(a.group);
    agents.push(a);
  }
  // 選択中のエージェントを囲む白い輪
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1.0, 48),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
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
  const pulseMap = new Map<string, number>();
  const anticipMap = new Map<string, number>();

  // --- ラベル ---
  function addLabel(
    main: string,
    anchor: () => P3 | null,
    cls = '',
    align: LabelAlign = 'center',
  ): HTMLElement {
    const el = document.createElement('div');
    el.className = `stage-label ${cls}`;
    el.textContent = main;
    labelLayer.appendChild(el);
    labels.push({ el, anchor, align });
    return el;
  }

  // 工程のラベル（番号・工程名・一言を 1 つの要素に入れる）
  function addStepLabel(num: number, name: string, caption: string, anchor: () => P3 | null): void {
    const el = document.createElement('div');
    el.className = 'stage-label step';
    const nameEl = document.createElement('div');
    nameEl.className = 'step-name';
    const numEl = document.createElement('span');
    numEl.className = 'step-num';
    numEl.textContent = String(num);
    nameEl.appendChild(numEl);
    nameEl.appendChild(document.createTextNode(name));
    const capEl = document.createElement('div');
    capEl.className = 'step-cap';
    capEl.textContent = caption;
    el.appendChild(nameEl);
    el.appendChild(capEl);
    labelLayer.appendChild(el);
    labels.push({ el, anchor, align: 'center' });
  }

  // 工程名。候補取得はパイプの下、ほかは床の下に横一列。
  addStepLabel(1, '候補取得', 'フォロー内・外から集める', () => ({ x: -15.2, y: 9.6, z: 0 }));
  addStepLabel(2, 'フィルタ', 'スパム・古い投稿を弾く', () => ({ x: -9.8, y: -1.6, z: 0 }));
  addStepLabel(3, 'スコアリング', '反応されそうなほど高い音', () => ({ x: 0, y: -1.6, z: 0 }));
  addStepLabel(4, '多様性調整', '同じ投稿者を抑える', () => ({ x: 7.15, y: -1.6, z: 0 }));
  addStepLabel(5, '選抜', '上位 3 件だけ通す', () => ({ x: 14.4, y: -1.6, z: 0 }));
  addStepLabel(6, 'フィード', '反応した話題に染まる', () => ({
    x: DISTRICT_CENTER.x,
    y: -1.6,
    z: 0,
  }));
  addLabel('フォロー内', () => ({ x: -16.0, y: PIPE_IN_MOUTH.y, z: 0 }), 'pipe-in');
  addLabel('フォロー外', () => ({ x: -16.0, y: PIPE_OUT_MOUTH.y, z: 0 }), 'pipe-out');
  addLabel('除外', () => ({ x: -5.2, y: -0.7, z: 0 }), 'dim');
  addLabel('落選', () => ({ x: 11.0, y: -0.7, z: 0 }), 'dim');
  for (let i = 0; i < 3; i++) {
    // 選抜の順位をベルの台座の中央に出す
    const hit = bellHit(i);
    const cy = hit.y - BELL_R;
    addLabel(String(i + 1), () => ({ x: hit.x, y: (cy - 0.6) / 2, z: 0 }), 'rank');
  }
  TOPICS.forEach((t, i) => {
    // 街の中心から見て外向きに、地区の円の縁から 0.5 離す
    const p = districtPos(i, TOPICS.length);
    const dx = p.x - DISTRICT_CENTER.x;
    const dy = p.y - DISTRICT_CENTER.y;
    const d = Math.hypot(dx, dy) || 1;
    const align: LabelAlign = dx / d > 0.3 ? 'left' : dx / d < -0.3 ? 'right' : 'center';
    const el = addLabel(
      t.name,
      () => ({
        x: p.x + (dx / d) * (DISTRICT_DISC_R + 0.5),
        y: p.y + (dy / d) * (DISTRICT_DISC_R + 0.5),
        z: 0,
      }),
      'topic',
      align,
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
      // エージェント名は全員ぶん常に出す（円の中）
      labels.push({ el, anchor: () => agentAnchor(i), align: 'center' });
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
    const p = pulseMap.get(`catch:${i}`) ?? 0;
    if (!s) return { x: DISTRICT_CENTER.x, y: DISTRICT_CENTER.y, z: 0 };
    return { x: s.x, y: s.y + s.hop - p * 0.18, z: 0 };
  }

  function agentAnchor(i: number): P3 | null {
    if (i >= motion.count()) return null;
    const p = agentPos(i);
    return { x: p.x, y: p.y, z: p.z };
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
      const ax = l.align === 'left' ? '0' : l.align === 'right' ? '-100%' : '-50%';
      l.el.style.transform = `translate(${ax}, -50%) translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
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
      if (d.reactions.like) spawnReactIcon('like', '♥', s, slot++, '#ffffff');
      if (d.reactions.reply) spawnReactIcon('reply', '…', s, slot++, '#ffffff');
      if (d.reactions.repost) spawnReactIcon('repost', '↻', s, slot++, '#ffffff');
      if (d.followed) spawnReactIcon('follow', '+フォロー', s, slot++, '#9aa0b0');
    }
  }

  // --- サイズ ---
  function applySize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    const halfW = Math.max(VIEW_W / 2, (VIEW_H / 2) * aspect);
    const halfH = halfW / aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    gl.setSize(w, h, false);
  }

  applySize();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(applySize).observe(canvas);
  }

  function drawBalls(world: World, beat: number): void {
    let nf = 0; // 塗りつぶし
    let nh = 0; // 輪（フォロー外）
    let bright = 1;
    const put = (s: BallState, tailFade: number) => {
      const r = s.radius * tailFade;
      tmpC.set(s.color).multiplyScalar(bright * tailFade * tailFade * Math.max(0, s.opacity));
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
      bright = selectedId !== null && c.agentId !== selectedId ? 0.35 : 1;
      // 頭と尾。尾は少し前の時刻に評価した位置に、だんだん小さく薄くする
      put(st, 1);
      for (let k = 1; k <= TAIL_STEPS && nf + nh < ballCap; k++) {
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
      tmpC.copy(s.color).multiplyScalar(f);
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
      // 円の色は興味の偏りで染まる（最初は全員白）
      const tint = interestTint(world.agents[i].interest);
      a.mat.color
        .copy(WHITE_C)
        .lerp(TOPIC_COLORS[tint.topic], tint.amount)
        .multiplyScalar(dim ? 0.35 : 1);
      agentLabels[i]?.classList.toggle('sel', i === selectedId);
      // フィードの話題構成を円を囲む輪で示す（話題順に並べ替えて、同じ話題がひとかたまりの弧に。
      // 足りない分は暗い区間。元の feed は並べ替えない）
      const feed = [...world.agents[i].feed].sort((x, y) => x.topic - y.topic);
      const step = (Math.PI * 2) / FEED_KEEP;
      for (let k = 0; k < FEED_KEEP && d < DOT_CAP; k++, d++) {
        const item = feed[k];
        tmpC.set(item ? TOPICS[item.topic].color : '#232936').multiplyScalar(dim ? 0.3 : 1);
        setInstance(
          feedRingMesh,
          d,
          { x: p.x, y: p.y, z: Z_FEED_DOT },
          1,
          1,
          tmpC,
          Math.PI / 2 - (k + 0.5) * step, // 真上から時計回りに並べる
        );
      }
    }
    feedRingMesh.count = d;
    feedRingMesh.instanceMatrix.needsUpdate = true;
    if (feedRingMesh.instanceColor) feedRingMesh.instanceColor.needsUpdate = true;
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
  // 当たる直前の ANTICIP_BEATS 拍のあいだは予告として少し明るくする。
  function applyPulses(world: World, beat: number): void {
    pulseMap.clear();
    anticipMap.clear();
    for (const c of world.candidates) {
      for (const h of timeline(c)) {
        const age = beat - h.time;
        const key = `${h.kind}:${h.index}`;
        if (age >= 0 && age <= PULSE_BEATS) {
          const p = 1 - age / PULSE_BEATS;
          if (p > (pulseMap.get(key) ?? 0)) pulseMap.set(key, p);
        } else if (age >= -ANTICIP_BEATS && age < 0 && ANTICIP_KINDS.has(h.kind)) {
          const a = 1 + age / ANTICIP_BEATS;
          if (a > (anticipMap.get(key) ?? 0)) anticipMap.set(key, a);
        }
      }
    }
    const pulse = (kind: string, i = 0) => pulseMap.get(`${kind}:${i}`) ?? 0;
    const anticip = (kind: string, i = 0) => anticipMap.get(`${kind}:${i}`) ?? 0;
    const glow = (mat: THREE.MeshBasicMaterial, kind: string, i = 0) => {
      mat.color.copy(REST_C).lerp(WHITE_C, clamp01(0.35 * anticip(kind, i) + pulse(kind, i)));
    };

    stage.drums.forEach((d, i) => {
      const p = pulse('drum', i);
      glow(d.mat, 'drum', i);
      d.group.scale.setScalar(1 + (d.kick ? 0.22 : 0.14) * p);
    });
    stage.vibeBars.forEach((b, i) => {
      const p = pulse('vibe', i);
      glow(b.mat, 'vibe', i);
      b.mesh.position.y = b.restY - 0.12 * p;
    });
    stage.bassStrings.forEach((s, i) => {
      const p = pulse('bass', i);
      glow(s.mat, 'bass', i);
      s.mesh.position.y = s.restY + Math.sin(timeSec * 55 + i * 2.1) * 0.09 * p;
    });
    stage.bells.forEach((b, i) => {
      const p = pulse('bell', i);
      glow(b.mat, 'bell', i);
      b.mesh.scale.setScalar(1 + 0.25 * p);
    });
    glow(stage.cymbalBar.mat, 'cymbal');
    stage.cymbalBar.mesh.rotation.z =
      stage.cymbalBar.baseRot + Math.sin(timeSec * 26) * 0.4 * pulse('cymbal');
    glow(stage.trapBar.mat, 'trap');
    stage.scrapBin.position.y = -0.09 * pulse('scrap');
    stage.rejectBin.position.y = -0.09 * pulse('reject');
    stage.pipes.forEach((pipe, i) => {
      const p = pulse('launch', i);
      pipe.group.position.x = -0.3 * p;
      pipe.ringMat.color.copy(REST_C).lerp(WHITE_C, p);
    });
    // キックの拍でわずかにズーム
    camera.zoom = 1 + 0.015 * pulse('drum', 0);
    camera.updateProjectionMatrix();
  }

  // 拍に合わせた背景の脈動。一時停止中は beat が進まないので止まる。
  function applyBeatPulse(beat: number): void {
    const frac = beat - Math.floor(beat);
    let beatPulse = Math.exp(-frac * 5);
    if (Math.floor(beat) % 4 === 0) beatPulse *= 1.6;
    bgColor.copy(BG0).lerp(BG1, Math.min(1, 0.6 * beatPulse));
  }

  // 当たった瞬間の波紋。状態は持たず、毎フレーム時刻表から計算する（applyPulses と同じ考え方）。
  const RIPPLE_GRAY = new THREE.Color('#8a90a2');
  function drawRipples(world: World, beat: number): void {
    let n = 0;
    for (const c of world.candidates) {
      const dim = selectedId !== null && c.agentId !== selectedId ? 0.35 : 1;
      for (const h of timeline(c)) {
        if (!RIPPLE_KINDS.has(h.kind)) continue;
        const age = beat - h.time;
        if (age < 0 || age > RIPPLE_BEATS) continue;
        if (n >= RIPPLE_CAP) break;
        const t = age / RIPPLE_BEATS;
        const fade = (1 - t) * (1 - t) * dim;
        if (h.kind === 'cymbal' || h.kind === 'trap') {
          tmpC.copy(RIPPLE_GRAY).multiplyScalar(fade);
        } else {
          tmpC.copy(TOPIC_COLORS[c.topic]).multiplyScalar(fade);
        }
        const p = hitPoint(h, c, agentPos(c.agentId));
        const r = 0.25 + 1.3 * t;
        setInstance(rippleMesh, n++, { x: p.x, y: p.y, z: Z_RIPPLE }, r, r, tmpC);
      }
      if (n >= RIPPLE_CAP) break;
    }
    rippleMesh.count = n;
    rippleMesh.instanceMatrix.needsUpdate = true;
    if (rippleMesh.instanceColor) rippleMesh.instanceColor.needsUpdate = true;
  }

  return {
    reset(world) {
      if (selectedId !== null && selectedId >= world.agents.length) selectedId = null;
      motion.reset(world.agents.length);
      sparks.length = 0;
      pending.length = 0;
      rebuildAgentLabels(world);
      timeSec = 0;
    },
    onBeat(_world, events) {
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
      applyPulses(world, beat);
      applyBeatPulse(beat);
      drawBalls(world, beat);
      drawRipples(world, beat);
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
  };
}
