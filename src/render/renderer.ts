// 3D ステージの描画。暗いステージに光る楽器が並び、パイプから発射されたボールが
// 放物線を描いて楽器から楽器へ跳ねる。当たる瞬間は show/score.ts の時刻表と一致する
// （音は audio/ が同じ時刻表から鳴らす）。
// DOM / WebGL に触れるのはこのファイルだけ（と instruments.ts のメッシュ生成）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { agentColor, FEED_KEEP, MAX_AGENT_COUNT, TOPICS } from '../sim/config';
import type { BeatEvents, Reactions, World } from '../sim/types';
import { timeline } from '../show/score';
import { createAgentMotion } from './agentMotion';
import { buildBowl, buildStage } from './instruments';
import {
  AGENT_BOWL_Y,
  BOWL_R,
  DISTRICT_CENTER,
  districtPos,
  hash01,
  PIPE_IN_MOUTH,
  PIPE_OUT_MOUTH,
  REJECT_BIN,
  SCRAP_BIN,
  VIBE_BAR_Y,
  VIBE_X,
  BELL_X,
  BELL_Y,
  DRUM_HITS,
  type P3,
} from './stageLayout';
import { ballState, TAIL_DT, TAIL_STEPS } from './trajectory';
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
const PULSE_BEATS = 0.5; // 当たったあとの発光が消えるまでの拍数
const SWAY_DELAY = 4; // 操作がないとこれだけ経ってからカメラが揺れ始める（秒）
const SWAY_PERIOD = 40;
const SWAY_AMP = THREE.MathUtils.degToRad(6);
const FIT_W = 19; // 横幅に収めたい半分の距離（パイプ口〜街の端 + 余白）
const FIT_H = 8;

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
  z: number;
  vx: number;
  vy: number;
  vz: number;
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
  gl.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070a12');
  scene.fog = new THREE.Fog('#070a12', 34, 80);
  // 金属の楽器は映り込みがないと真っ黒になるので、弱い環境マップを置く
  const pmrem = new THREE.PMREMGenerator(gl);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  const target = new THREE.Vector3(3.5, 1.5, 0);
  camera.position.set(3.5, 9, 22);
  camera.lookAt(target);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 0.15; // 真上からは見すぎない
  controls.maxPolarAngle = 1.45; // 床の下に潜らない

  // 照明: 弱い環境光 + 上からのスポット 3 灯（距離減衰があるので強め）
  scene.add(new THREE.HemisphereLight('#9fb4e0', '#1a1410', 0.9));
  const spot1 = new THREE.SpotLight('#fff2dd', 260, 70, 0.75, 0.6);
  spot1.position.set(-4, 16, 8);
  spot1.target.position.set(-4, 0, 0);
  scene.add(spot1, spot1.target);
  const spot2 = new THREE.SpotLight('#dfe8ff', 110, 70, 0.75, 0.6);
  spot2.position.set(13, 15, 5);
  spot2.target.position.set(13, 0, 0);
  scene.add(spot2, spot2.target);
  const spot3 = new THREE.SpotLight('#ffe4c0', 120, 70, 0.5, 0.6);
  spot3.position.set(-11, 13, -2);
  spot3.target.position.set(-10, 5, 0);
  scene.add(spot3, spot3.target);

  const stage = buildStage();
  scene.add(stage.group);

  // ボールと尾は 1 つの InstancedMesh で描く（基本色 x インスタンス色で発光させる）
  const ballMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    BALL_CAP * (1 + TAIL_STEPS),
  );
  ballMesh.count = 0;
  ballMesh.frustumCulled = false;
  scene.add(ballMesh);

  // 配信の火花
  const sparkMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.05, 6, 5),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    SPARK_CAP,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  // 受け皿の縁に並ぶフィードの粒（全エージェント分を 1 つの InstancedMesh で）
  const dotMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.05, 6, 5),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    DOT_CAP,
  );
  dotMesh.count = 0;
  dotMesh.frustumCulled = false;
  scene.add(dotMesh);
  const dotWhite = new THREE.Color('#ffffff');
  for (let i = 0; i < DOT_CAP; i++) dotMesh.setColorAt(i, dotWhite);

  // エージェントの受け皿（最大数だけ作り置きして表示数を変える）
  const bowls: { group: THREE.Group; mat: THREE.MeshStandardMaterial }[] = [];
  for (let i = 0; i < MAX_AGENT_COUNT; i++) {
    const b = buildBowl();
    b.group.visible = false;
    scene.add(b.group);
    bowls.push(b);
  }
  // 選択中の受け皿を囲む白い輪
  const selRing = new THREE.Mesh(
    new THREE.TorusGeometry(BOWL_R + 0.16, 0.03, 8, 40),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  );
  selRing.rotation.x = Math.PI / 2;
  selRing.visible = false;
  scene.add(selRing);

  const composer = new EffectComposer(gl);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.7, 0.45, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const motion = createAgentMotion();
  const sparks: Spark[] = [];
  const pending: PendingDelivery[] = [];
  const labels: Label[] = [];
  const agentLabels: HTMLElement[] = [];
  let selectedId: number | null = null;
  let timeSec = 0;
  let fitDist = 0;
  const pulseMap = new Map<string, number>();

  // 静止している間にカメラを左右にゆっくり振る
  let interacting = false;
  let lastInteract = -100;
  let baseAzim = 0;
  let swaying = true; // 揺れの基準角（baseAzim）を取り終えたか
  let swayStart = -100 + SWAY_DELAY;
  controls.addEventListener('start', () => {
    interacting = true;
  });
  controls.addEventListener('end', () => {
    interacting = false;
    lastInteract = performance.now() / 1000;
    swaying = false;
  });

  // --- ラベル ---
  function addLabel(main: string, sub: string, anchor: () => P3 | null, cls = ''): void {
    const el = document.createElement('div');
    el.className = `stage-label ${cls}`;
    el.textContent = main;
    if (sub) {
      const s = document.createElement('span');
      s.className = 'stage-label-sub';
      s.textContent = sub;
      el.appendChild(s);
    }
    labelLayer.appendChild(el);
    labels.push({ el, anchor });
  }

  addLabel('フォロー内', 'Thunder', () => ({ ...PIPE_IN_MOUTH, y: PIPE_IN_MOUTH.y + 1.0 }));
  addLabel('フォロー外', 'Phoenix 検索', () => ({ ...PIPE_OUT_MOUTH, y: PIPE_OUT_MOUTH.y + 1.0 }));
  addLabel('フィルタ', 'ドラム', () => ({ x: DRUM_HITS[0].x, y: 3.3, z: 0 }));
  addLabel('スクラップ', '', () => ({ x: SCRAP_BIN.x, y: 1.9, z: SCRAP_BIN.z }));
  addLabel('スコアリング', 'ビブラフォン', () => ({ x: VIBE_X, y: VIBE_BAR_Y + 1.2, z: 0 }));
  addLabel('多様性調整', 'ベース', () => ({ x: 2, y: 2.9, z: 0 }));
  addLabel('選抜', 'ベル・上位 3 件', () => ({ x: BELL_X, y: BELL_Y + 1.6, z: 0 }));
  addLabel('落選', '', () => ({ x: REJECT_BIN.x, y: 1.9, z: REJECT_BIN.z }));
  TOPICS.forEach((t, i) => {
    addLabel(t.name, '', () => {
      const p = districtPos(i, TOPICS.length);
      return { x: p.x, y: 0.4, z: p.z };
    }, 'topic');
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
      labels.push({ el, anchor: () => agentAnchor(i, -0.5) });
    });
  }

  // --- 小物 ---
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();

  function setInstance(mesh: THREE.InstancedMesh, i: number, p: P3, r: number, c: THREE.Color) {
    tmpV.set(p.x, p.y, p.z);
    tmpS.setScalar(Math.max(r, 1e-4));
    tmpM.compose(tmpV, tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);
    mesh.setColorAt(i, c);
  }

  // 受け皿の今の位置（catch のパルスで沈む分も込み）。ボールの終点とラベル・ヒットテストが使う。
  function bowlPos(i: number): P3 {
    const s = motion.pos(i);
    const p = pulseMap.get(`catch:${i}`) ?? 0;
    if (!s) return { x: DISTRICT_CENTER.x, y: AGENT_BOWL_Y, z: DISTRICT_CENTER.z };
    return { x: s.x, y: AGENT_BOWL_Y + s.y - p * 0.18, z: s.z };
  }

  function agentAnchor(i: number, dy: number): P3 | null {
    if (i >= motion.count()) return null;
    const p = bowlPos(i);
    return { x: p.x, y: p.y + dy, z: p.z };
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

  // 配信の演出（受け皿に届いた瞬間）。火花 + 反応アイコン + 受け皿の弾み。
  function fireDelivery(d: PendingDelivery): void {
    const p = bowlPos(d.agentId);
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
        z: p.z,
        vx: Math.cos(ang) * sp,
        vy: 2.2 + 2 * hash01(j * 7 + seed),
        vz: Math.sin(ang) * sp,
        age: 0,
        ttl: 0.5,
        color: new THREE.Color(col),
      });
    }
    const s = toLabelPos(p);
    if (s) {
      let slot = 0;
      const ac = agentColor(d.agentId, motion.count());
      if (d.reactions.like) spawnReactIcon('like', '♥', s, slot++, ac);
      if (d.reactions.reply) spawnReactIcon('reply', '…', s, slot++, ac);
      if (d.reactions.repost) spawnReactIcon('repost', '↻', s, slot++, ac);
      if (d.followed) spawnReactIcon('follow', '+フォロー', s, slot++, '#cfd4e0');
    }
  }

  // --- サイズ ---
  function fitDistance(aspect: number): number {
    const v = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(FIT_W / (v * aspect), FIT_H / v) * 1.05;
  }

  function applySize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const fit = fitDistance(w / h);
    // 前の fit に対するズーム比を保ったまま距離を合わせる
    const dir = tmpV.copy(camera.position).sub(controls.target).normalize();
    const cur = camera.position.distanceTo(controls.target);
    const ratio = fitDist > 0 ? THREE.MathUtils.clamp(cur / fitDist, 0.5, 1.6) : 1;
    camera.position.copy(controls.target).addScaledVector(dir, fit * ratio);
    controls.minDistance = fit * 0.5;
    controls.maxDistance = fit * 1.6;
    fitDist = fit;
    gl.setSize(w, h, false);
    composer.setSize(w, h);
  }

  applySize();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(applySize).observe(canvas);
  }

  function drawBalls(world: World, beat: number): void {
    let n = 0;
    const cap = BALL_CAP * (1 + TAIL_STEPS);
    for (const c of world.candidates) {
      if (n >= cap) break;
      const ap = bowlPos(c.agentId);
      const st = ballState(c, beat, ap);
      if (!st.visible) continue;
      const dim = selectedId !== null && c.agentId !== selectedId;
      const bright = dim ? 0.5 : 1.9;
      tmpC.set(st.color).multiplyScalar(bright * Math.max(0.15, st.opacity));
      setInstance(ballMesh, n++, st.pos, st.radius * (dim ? 0.7 : 1), tmpC);
      // 尾: 少し前の時刻に評価した位置に、だんだん小さく薄い球を置く
      for (let k = 1; k <= TAIL_STEPS && n < cap; k++) {
        const ts = ballState(c, beat - k * TAIL_DT, ap);
        if (!ts.visible) break;
        const f = 1 - k / (TAIL_STEPS + 2);
        tmpC.set(ts.color).multiplyScalar(bright * f * f * Math.max(0.15, ts.opacity));
        setInstance(ballMesh, n++, ts.pos, ts.radius * f * (dim ? 0.7 : 1), tmpC);
      }
    }
    ballMesh.count = n;
    ballMesh.instanceMatrix.needsUpdate = true;
    if (ballMesh.instanceColor) ballMesh.instanceColor.needsUpdate = true;
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
      s.z += s.vz * dt;
    }
    for (const s of sparks) {
      if (n >= SPARK_CAP) break;
      const f = 1 - s.age / s.ttl;
      tmpC.copy(s.color).multiplyScalar(2 * f);
      setInstance(sparkMesh, n++, s, 0.05 * (0.4 + 0.6 * f), tmpC);
    }
    sparkMesh.count = n;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
  }

  function drawAgents(world: World): void {
    const n = world.agents.length;
    let d = 0;
    for (let i = 0; i < n && i < bowls.length; i++) {
      const s = motion.pos(i);
      const b = bowls[i];
      if (!s) {
        b.group.visible = false;
        continue;
      }
      const dim = selectedId !== null && i !== selectedId;
      const p = bowlPos(i);
      b.group.visible = true;
      b.group.position.set(p.x, p.y, p.z);
      b.group.scale.setScalar((dim ? 0.75 : 1) * (1 + s.pop * 0.12));
      // agentColor は CSS 用の hsl() 文字列（空白区切り）で three.js が読めないので、同じ色を数値で作る
      b.mat.color.setHSL(i / Math.max(1, n), 0.65, 0.55).multiplyScalar(dim ? 0.4 : 1);
      // フィードの話題構成を縁の粒で示す（足りない分は暗い粒）
      const feed = world.agents[i].feed;
      for (let k = 0; k < FEED_KEEP && d < DOT_CAP; k++, d++) {
        const ang = (k / FEED_KEEP) * Math.PI * 2 - Math.PI / 2;
        const item = feed[k];
        tmpC.set(item ? TOPICS[item.topic].color : '#232936').multiplyScalar(dim ? 0.3 : 1.1);
        setInstance(
          dotMesh,
          d,
          { x: p.x + Math.cos(ang) * (BOWL_R + 0.12), y: p.y + 0.3, z: p.z + Math.sin(ang) * (BOWL_R + 0.12) },
          0.05,
          tmpC,
        );
      }
    }
    dotMesh.count = d;
    dotMesh.instanceMatrix.needsUpdate = true;
    if (dotMesh.instanceColor) dotMesh.instanceColor.needsUpdate = true;
    for (let i = n; i < bowls.length; i++) bowls[i].group.visible = false;
    if (selectedId !== null && selectedId < n) {
      const p = bowlPos(selectedId);
      selRing.visible = true;
      selRing.position.set(p.x, p.y - 0.1, p.z);
    } else {
      selRing.visible = false;
    }
  }

  // 当たった瞬間の発光と揺れ。楽器ごとの「最後に当たってからの拍数」から決める。
  function applyPulses(world: World, beat: number): void {
    pulseMap.clear();
    for (const c of world.candidates) {
      for (const h of timeline(c)) {
        const age = beat - h.time;
        if (age < 0 || age > PULSE_BEATS) continue;
        const key = `${h.kind}:${h.index}`;
        const p = 1 - age / PULSE_BEATS;
        if (p > (pulseMap.get(key) ?? 0)) pulseMap.set(key, p);
      }
    }
    const pulse = (kind: string, i = 0) => pulseMap.get(`${kind}:${i}`) ?? 0;

    stage.drums.forEach((d, i) => {
      const p = pulse('drum', i);
      d.face.position.y = -0.03 - 0.12 * p;
      d.mat.emissiveIntensity = 1.7 * p;
      d.group.scale.setScalar(d.kick ? 1 + 0.15 * p : 1);
    });
    stage.vibeBars.forEach((b, i) => {
      const p = pulse('vibe', i);
      b.mesh.position.y = b.restY - 0.07 * p;
      b.mat.emissiveIntensity = 1.8 * p;
    });
    stage.bassStrings.forEach((s, i) => {
      const p = pulse('bass', i);
      s.mesh.position.z = s.baseZ + Math.sin(timeSec * 55 + i * 2.1) * 0.09 * p;
      s.mat.emissiveIntensity = 1.6 * p;
    });
    stage.bells.forEach((b, i) => {
      const p = pulse('bell', i);
      b.group.rotation.x = Math.sin(timeSec * 9 + i * 1.3) * 0.35 * p;
      b.mat.emissiveIntensity = 0.9 * p;
    });
    {
      const p = pulse('cymbal');
      stage.cymbal.mesh.rotation.z = Math.sin(timeSec * 26) * 0.4 * p;
      stage.cymbal.mat.emissiveIntensity = 1.6 * p;
      stage.trapRimMat.emissiveIntensity = 0.2 + 2.4 * pulse('trap');
      stage.scrapBin.position.y = -0.09 * pulse('scrap');
      stage.rejectBin.position.y = -0.09 * pulse('reject');
    }
    stage.pipes.forEach((pipe, i) => {
      const p = pulse('launch', i);
      pipe.group.position.x = -0.3 * p;
      pipe.ringMat.emissiveIntensity = 0.6 + 3 * p;
    });
  }

  function applySway(): void {
    const now = performance.now() / 1000;
    if (interacting || now - lastInteract < SWAY_DELAY) return;
    if (!swaying) {
      // 手を離したあとも慣性で回るので、揺れを再開する瞬間の角度を基準にする
      swaying = true;
      swayStart = now;
      baseAzim = controls.getAzimuthalAngle();
    }
    const t = now - swayStart;
    const ramp = Math.min(1, t / 3);
    const azim = baseAzim + Math.sin((t / SWAY_PERIOD) * Math.PI * 2) * SWAY_AMP * ramp;
    tmpV.copy(camera.position).sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(tmpV);
    sph.theta = azim;
    tmpV.setFromSpherical(sph);
    camera.position.copy(controls.target).add(tmpV);
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
      applySway();
      controls.update();
      drawBalls(world, beat);
      drawSparks(dt);
      drawAgents(world);
      placeLabels();
      composer.render();
    },
    hitTestAgent(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      let best = -1;
      let bestD = 36;
      for (let i = 0; i < motion.count(); i++) {
        const s = toScreen(bowlPos(i));
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
