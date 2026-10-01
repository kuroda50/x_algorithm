import { agentColor, MOVE_FRACTION, SELECT_K, TOPICS } from '../sim/config';
import type { BeatEvents, Candidate, Reactions, World } from '../sim/types';
import { createAgentMotion } from './agentMotion';
import {
  BIN_H,
  clamp01,
  drawBarLamps,
  drawBelt,
  drawBin,
  drawHopper,
  drawHopperShutter,
  drawInspector,
  drawInspectorBeam,
  drawPress,
  drawPressJaws,
  drawSorter,
  drawSorterArm,
  drawTrimmer,
  isAccent,
  strokeAt,
} from './factory';
import {
  agentRoute,
  DISTRICT_CENTER,
  districtPos,
  easeInOut,
  hash01,
  IN_LINE,
  laneOffset,
  OUT_LINE,
  pointAlongFrac,
  STATION_IN,
  STATION_OUT,
  STATIONS,
  TRUNK_LINE,
  type Pt,
} from './layout';
import { bubblePath, shapePath } from './shapes';

// Canvas の論理サイズ。表示は幅 100% に縮小される。
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

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

interface Colors {
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  lineIn: string;
  lineOut: string;
  lineTrunk: string;
  danger: string;
}

const DEFAULT_COLORS: Colors = {
  text: '#1a1a19',
  textMuted: '#73726c',
  surface: '#ffffff',
  border: '#c9c7bd',
  lineIn: '#378ADD',
  lineOut: '#EF9F27',
  lineTrunk: '#888780',
  danger: '#E24B4A',
};

type ParticleKind = 'like' | 'reply' | 'repost' | 'follow' | 'burst';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  color: string;
}

interface PendingDelivery {
  at: number; // 演出を始めるビート位置（出来事のビート + MOVE_FRACTION）
  agentId: number;
  topic: number;
  reactions: Reactions;
  followed: boolean;
}

type CandidateMode = 'move' | 'fall' | 'shrink' | 'absorb';

interface CandidateGeom {
  x: number;
  y: number;
  mode: CandidateMode;
  age: number; // 終端演出に入ってからのビート数（move では未使用）
  spawn: boolean; // 始発駅でふわっと現れる最中か
  phase: number;
}

// 機械とラベルの位置。主ラベルはアルゴリズムの用語、副ラベルは機械名。
const MACHINE_LABELS = [
  // 搬入口は箱の中心（駅の位置から左へ 22）に合わせ、ベルトのレールを避ける
  { p: { x: STATION_IN.x - 22, y: STATION_IN.y }, name: 'フォロー内', sub: 'Thunder', y: 234, subY: 247 },
  { p: { x: STATION_OUT.x - 22, y: STATION_OUT.y }, name: 'フォロー外', sub: 'Phoenix 検索', y: 510, subY: 523 },
  { p: STATIONS[1], name: 'フィルタ', sub: '検品', y: 238, subY: 252 },
  { p: STATIONS[2], name: 'スコアリング', sub: 'プレス', y: 238, subY: 252 },
  { p: STATIONS[3], name: '多様性調整', sub: '削り', y: 238, subY: 252 },
  { p: STATIONS[4], name: '選抜', sub: `上位 ${SELECT_K} 件を仕分け`, y: 238, subY: 252 },
];

const BIN_Y = 460;
const BIN_MOUTH_Y = BIN_Y - BIN_H / 2 + 4; // 箱の口（上辺の少し内側）
const SCRAP_BIN = { x: STATIONS[1].x, y: BIN_Y }; // スクラップ箱: フィルタの真下
const REJECT_BIN = { x: STATIONS[4].x, y: BIN_Y }; // 落選箱: 選抜の真下

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CanvasRenderingContext2D is not available');
  const ctx: CanvasRenderingContext2D = context;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  ctx.scale(dpr, dpr);

  let colors = DEFAULT_COLORS;
  let frame = 0;
  let timeSec = 0;
  let selectedId: number | null = null;
  const motion = createAgentMotion();
  const particles: Particle[] = [];
  const pending: PendingDelivery[] = [];
  const radii = new Map<number, number>();
  const pulse = new Array<number>(5).fill(0);

  function readColors(): void {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
    const cs = getComputedStyle(document.documentElement);
    const g = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    colors = {
      text: g('--text', DEFAULT_COLORS.text),
      textMuted: g('--text-muted', DEFAULT_COLORS.textMuted),
      surface: g('--surface', DEFAULT_COLORS.surface),
      border: g('--border', DEFAULT_COLORS.border),
      lineIn: g('--line-in', DEFAULT_COLORS.lineIn),
      lineOut: g('--line-out', DEFAULT_COLORS.lineOut),
      lineTrunk: g('--line-trunk', DEFAULT_COLORS.lineTrunk),
      danger: g('--danger', DEFAULT_COLORS.danger),
    };
  }

  // エージェントの描画位置（ばねの位置＋小さな上下運動）。ヒットテストもここを使う。
  function agentDrawPos(i: number): Pt {
    const s = motion.pos(i);
    if (!s) return { x: DISTRICT_CENTER.x, y: DISTRICT_CENTER.y };
    return { x: s.x, y: s.y + Math.sin(timeSec * 2 + i * 1.3) * 1.5 };
  }

  function strokeLine(pts: readonly Pt[], color: string, width: number, alpha: number): void {
    if (pts.length < 2) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawDistricts(): void {
    const n = TOPICS.length;
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const d = districtPos(i % n, n);
      if (i === 0) ctx.moveTo(d.x, d.y);
      else ctx.lineTo(d.x, d.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const d = districtPos(i, n);
      const t = TOPICS[i];
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.color;
      shapePath(ctx, t.shape, d.x, d.y - 8, 13);
      ctx.fill();
      ctx.fillStyle = colors.text;
      ctx.font = '12px sans-serif';
      ctx.fillText(t.name, d.x, d.y + 18);
    }
  }

  function drawLegend(): void {
    const y1 = 652;
    const y2 = 684;
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let x = 44;
    for (const t of TOPICS) {
      ctx.fillStyle = t.color;
      shapePath(ctx, t.shape, x, y1, 7);
      ctx.fill();
      ctx.fillStyle = colors.textMuted;
      ctx.fillText(t.name, x + 12, y1);
      x += 76;
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = colors.lineIn;
    ctx.beginPath();
    ctx.moveTo(44, y2);
    ctx.lineTo(66, y2);
    ctx.stroke();
    ctx.strokeStyle = colors.lineOut;
    ctx.beginPath();
    ctx.moveTo(160, y2);
    ctx.lineTo(182, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText('フォロー内ライン', 72, y2);
    ctx.fillText('フォロー外ライン', 188, y2);
  }

  function drawLabels(): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of MACHINE_LABELS) {
      ctx.fillStyle = colors.text;
      ctx.font = '12px sans-serif';
      ctx.fillText(s.name, s.p.x, s.y);
      ctx.fillStyle = colors.textMuted;
      ctx.font = '9px sans-serif';
      ctx.fillText(s.sub, s.p.x, s.subY);
    }
  }

  // 候補の位置と表示モード。終端（除外・落選・配信）は到着時刻を越えたあとも描き続ける。
  function candidateGeom(c: Candidate, beat: number, agentCount: number): CandidateGeom | null {
    const k = Math.floor(beat) - c.startBeat;
    if (k < 0) return null;
    const phase = beat - Math.floor(beat);
    const fin = c.dropStage ?? 5;
    const tFinal = c.startBeat + fin + MOVE_FRACTION;
    const lane = laneOffset(c.agentId, agentCount, c.id);
    const src = c.source === 'in' ? IN_LINE : OUT_LINE;
    if (beat >= tFinal) {
      const age = beat - tFinal;
      if (fin === 5) {
        const a = agentDrawPos(c.agentId);
        return { x: a.x, y: a.y, mode: 'absorb', age, spawn: false, phase };
      }
      const path = fin === 1 ? src : [STATIONS[3], STATIONS[4]];
      const p = pointAlongFrac(path, 1);
      return {
        x: p.x - p.dy * lane,
        y: p.y + p.dx * lane,
        mode: fin === 1 ? 'fall' : 'shrink',
        age,
        spawn: false,
        phase,
      };
    }
    if (k === 0) {
      const p = pointAlongFrac(src, 0);
      return {
        x: p.x - p.dy * lane,
        y: p.y + p.dx * lane,
        mode: 'move',
        age: 0,
        spawn: true,
        phase,
      };
    }
    const leg = Math.min(k, fin);
    const path =
      leg === 1
        ? src
        : leg === 5
          ? agentRoute(STATIONS[4], agentDrawPos(c.agentId))
          : [STATIONS[leg - 1], STATIONS[leg]];
    const u = Math.min(1, phase / MOVE_FRACTION);
    const e = easeInOut(u);
    const p = pointAlongFrac(path, e);
    // 最後の区間はレーンのずれを 0 まで絞り、エージェントの中心にそのまま着くようにする。
    const off = leg === 5 ? lane * (1 - e) : lane;
    return {
      x: p.x - p.dy * off,
      y: p.y + p.dx * off,
      mode: 'move',
      age: 0,
      spawn: false,
      phase,
    };
  }

  // 図形の目標半径。プレスが打つ拍頭（startBeat + 3）で score、
  // 削り機が打つ拍頭（startBeat + 4）で adjusted に応じて変わる。
  function targetRadius(c: Candidate, beat: number, maxScore: number, maxAdj: number): number {
    if (beat >= c.startBeat + 4) {
      return 5 + 9 * (maxAdj > 0 ? c.adjusted / maxAdj : 0);
    }
    if (beat >= c.startBeat + 3) {
      return 5 + 9 * (maxScore > 0 ? c.score / maxScore : 0);
    }
    return 7;
  }

  function drawCandidates(world: World, beat: number, dt: number): void {
    const nAgents = world.agents.length;
    let maxScore = 0;
    let maxAdj = 0;
    for (const c of world.candidates) {
      if (c.score > maxScore) maxScore = c.score;
      if (c.adjusted > maxAdj) maxAdj = c.adjusted;
    }
    const alive = new Set<number>();
    for (const c of world.candidates) {
      alive.add(c.id);
      const g = candidateGeom(c, beat, nAgents);
      if (!g) continue;
      let alpha = 1;
      let scale = 1;
      let color = TOPICS[c.topic].color;
      let x = g.x;
      let y = g.y;
      if (g.mode === 'fall') {
        alpha = Math.max(0, 1 - g.age / 1.15);
        color = colors.danger;
        // 検品機にはじかれ、スクラップ箱の口で止まる
        y += Math.min(Math.max(0, BIN_MOUTH_Y - g.y), 150 * Math.pow(g.age, 1.8));
      } else if (g.mode === 'shrink') {
        // 仕分けアームに払われ、落選箱の口まで落ちてから縮んで消える
        color = colors.lineTrunk;
        const e = easeInOut(Math.min(1, g.age / 0.5));
        x = g.x + (REJECT_BIN.x - g.x) * e;
        y = g.y + (BIN_MOUTH_Y - g.y) * e;
        if (g.age > 0.5) {
          const s = Math.max(0, 1 - (g.age - 0.5) / 0.3);
          alpha = s;
          scale = s;
        }
      } else if (g.mode === 'absorb') {
        const s = Math.max(0, 1 - g.age / 0.3);
        alpha = s;
        scale = s;
      } else if (g.spawn) {
        // 搬入口のシャッターが開くタイミング（ハット）に合わせて出る
        scale = easeInOut(clamp01((g.phase - 0.3) / 0.2));
        alpha = clamp01((g.phase - 0.3) / 0.15);
      }
      const tr = targetRadius(c, beat, maxScore, maxAdj);
      const r = (radii.get(c.id) ?? 7) + (tr - (radii.get(c.id) ?? 7)) * Math.min(1, dt * 8);
      radii.set(c.id, r);
      const dim = selectedId !== null && c.agentId !== selectedId;
      ctx.globalAlpha = alpha * (dim ? 0.25 : 1);
      ctx.fillStyle = color;
      shapePath(ctx, TOPICS[c.topic].shape, x, y, Math.max(0.1, r * scale));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const id of radii.keys()) if (!alive.has(id)) radii.delete(id);
  }

  function drawAgents(world: World): void {
    const n = world.agents.length;
    const counts = new Array<number>(TOPICS.length).fill(0);
    for (let i = 0; i < n; i++) {
      const a = world.agents[i];
      const s = motion.pos(i);
      if (!s) continue;
      const p = agentDrawPos(i);
      const col = agentColor(i, n);
      const dim = selectedId !== null && i !== selectedId;
      const alpha = dim ? 0.25 : 1;

      // フィードの話題構成を表すドーナツリング
      counts.fill(0);
      for (const f of a.feed) counts[f.topic]++;
      ctx.lineWidth = 4;
      if (a.feed.length > 0) {
        let ang = -Math.PI / 2;
        for (let j = 0; j < TOPICS.length; j++) {
          const share = counts[j] / a.feed.length;
          if (share <= 0) continue;
          const len = share * Math.PI * 2;
          ctx.strokeStyle = TOPICS[j].color;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 20, ang + 0.03, ang + len - 0.03);
          ctx.stroke();
          ang += len;
        }
      } else {
        ctx.strokeStyle = colors.border;
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 本体
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13 + s.pop * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.surface;
      ctx.beginPath();
      ctx.arc(p.x - 4, p.y - 2, 1.7, 0, Math.PI * 2);
      ctx.arc(p.x + 4, p.y - 2, 1.7, 0, Math.PI * 2);
      ctx.fill();
      if (i === selectedId) {
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 名前（下地を付けて読みやすく）
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = colors.surface;
      ctx.lineWidth = 3;
      ctx.strokeText(a.name, p.x, p.y + 34);
      ctx.fillStyle = colors.text;
      ctx.fillText(a.name, p.x, p.y + 34);
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles(): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of particles) {
      const a = Math.max(0, 1 - p.age / p.ttl);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === 'burst') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'like') {
        ctx.font = '15px sans-serif';
        ctx.fillText('♥', p.x, p.y);
      } else if (p.kind === 'repost') {
        ctx.font = '16px sans-serif';
        ctx.fillText('↻', p.x, p.y);
      } else if (p.kind === 'reply') {
        bubblePath(ctx, p.x, p.y, 7);
        ctx.fill();
      } else {
        ctx.font = '10px sans-serif';
        ctx.fillText('+フォロー', p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function spawnIcon(kind: ParticleKind, p: Pt, color: string, slot: number): void {
    particles.push({
      kind,
      x: p.x + (slot - 1) * 15,
      y: p.y - 16,
      vx: 0,
      vy: -32,
      age: 0,
      ttl: 1.0,
      color,
    });
  }

  // 配信の演出。届いた拍の +MOVE_FRACTION を越えたフレームで発火する。
  function firePending(world: World, beat: number): void {
    for (let i = pending.length - 1; i >= 0; i--) {
      const d = pending[i];
      if (beat < d.at) continue;
      pending.splice(i, 1);
      const p = agentDrawPos(d.agentId);
      const col = agentColor(d.agentId, world.agents.length);
      const nR =
        (d.reactions.like ? 1 : 0) + (d.reactions.reply ? 1 : 0) + (d.reactions.repost ? 1 : 0);
      motion.kick(d.agentId, 50 + 60 * nR);
      let slot = 0;
      if (d.reactions.like) spawnIcon('like', p, col, slot++);
      if (d.reactions.reply) spawnIcon('reply', p, col, slot++);
      if (d.reactions.repost) spawnIcon('repost', p, col, slot++);
      if (d.followed) spawnIcon('follow', p, colors.textMuted, slot++);
      const seed = d.agentId * 31 + d.at * 7;
      for (let j = 0; j < 7; j++) {
        const ang = (j / 7) * Math.PI * 2 + hash01(seed) * 0.6;
        const sp = 45 + 45 * hash01(j * 13 + d.agentId);
        particles.push({
          kind: 'burst',
          x: p.x,
          y: p.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          age: 0,
          ttl: 0.5,
          color: TOPICS[d.topic].color,
        });
      }
    }
  }

  return {
    reset(world) {
      if (selectedId !== null && selectedId >= world.agents.length) selectedId = null;
      motion.reset(world.agents.length);
      particles.length = 0;
      pending.length = 0;
      radii.clear();
      pulse.fill(0);
      timeSec = 0;
    },
    onBeat(_world, events) {
      for (const d of events.delivered) {
        pending.push({
          at: events.beat + MOVE_FRACTION,
          agentId: d.candidate.agentId,
          topic: d.candidate.topic,
          reactions: d.item.reactions,
          followed: d.followed,
        });
      }
      motion.beatHop(events.beat);
    },
    draw(world, beat, dt) {
      frame++;
      timeSec += dt;
      if (frame % 30 === 1) readColors();
      if (motion.count() !== world.agents.length) motion.reset(world.agents.length);
      firePending(world, beat);
      motion.update(world, dt);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.ttl) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      const phase = beat - Math.floor(beat);

      // 駅の脈打ち: 各候補が最後に駅へ着いた時刻からの経過で決める。
      pulse.fill(0);
      for (const c of world.candidates) {
        const k = Math.floor(beat) - c.startBeat;
        const fin = c.dropStage ?? 5;
        const jmax = Math.min(Math.min(k, fin), 4);
        for (let j = 1; j <= jmax; j++) {
          const age = beat - (c.startBeat + j + MOVE_FRACTION);
          if (age >= 0) pulse[j] = Math.max(pulse[j], 1 - age / 0.35);
        }
      }

      // 機械の状態。このフレームの候補の終端演出から、検品機の点滅と箱の沈み込みを決める。
      let rejectFlash = false;
      let scrapSink = 0;
      let rejectSink = 0;
      for (const c of world.candidates) {
        if (c.dropStage === 1) {
          const age = beat - (c.startBeat + 1 + MOVE_FRACTION);
          if (age >= 0 && age <= 0.3) rejectFlash = true;
          if (age > 0.85) {
            scrapSink = Math.max(scrapSink, 2 * Math.max(0, 1 - (age - 0.85) / 0.45));
          }
        } else if (c.dropStage === 4) {
          const age = beat - (c.startBeat + 4 + MOVE_FRACTION);
          if (age > 0.5) {
            rejectSink = Math.max(rejectSink, 2 * Math.max(0, 1 - (age - 0.5) / 0.45));
          }
        }
      }
      const shutterS = strokeAt(phase, 0.5);
      const pressS = strokeAt(phase, 0);
      const armS = strokeAt(phase, 0.75);
      const accent = isAccent(beat);

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawDistricts();
      drawBelt(ctx, IN_LINE, colors.lineIn, colors, beat);
      drawBelt(ctx, OUT_LINE, colors.lineOut, colors, beat);
      drawBelt(ctx, TRUNK_LINE, colors.lineTrunk, colors, beat, TRUNK_LINE.length - 1);
      const nAgents = world.agents.length;
      for (let i = 0; i < nAgents; i++) {
        const dim = selectedId !== null && i !== selectedId;
        const a = selectedId === null ? 0.35 : dim ? 0.1 : 0.85;
        strokeLine(
          agentRoute(STATIONS[4], agentDrawPos(i)),
          agentColor(i, nAgents),
          i === selectedId ? 4 : 3,
          a,
        );
      }
      drawLegend();
      drawBin(ctx, SCRAP_BIN, 'スクラップ', scrapSink, colors);
      drawBin(ctx, REJECT_BIN, '落選', rejectSink, colors);
      drawBarLamps(ctx, (STATIONS[2].x + STATIONS[3].x) / 2, 232, beat, colors);
      // 機械の本体（候補より下に来る部分）とラベル
      drawHopper(ctx, STATION_IN, colors);
      drawHopper(ctx, STATION_OUT, colors);
      drawInspector(ctx, STATIONS[1], rejectFlash, colors);
      drawPress(ctx, STATIONS[2], colors);
      drawTrimmer(ctx, STATIONS[3], beat, colors);
      drawSorter(ctx, STATIONS[4], colors);
      drawLabels();
      drawCandidates(world, beat, dt);
      // 機械のうち候補の上に重ねる部分
      drawHopperShutter(ctx, STATION_IN, shutterS, colors);
      drawHopperShutter(ctx, STATION_OUT, shutterS, colors);
      drawInspectorBeam(ctx, STATIONS[1], phase, pulse[1], rejectFlash, colors);
      drawPressJaws(ctx, STATIONS[2], pressS, accent, colors);
      drawSorterArm(ctx, STATIONS[4], armS, colors);
      drawAgents(world);
      drawParticles();
    },
    hitTestAgent(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const x = (clientX - rect.left) * (CANVAS_W / rect.width);
      const y = (clientY - rect.top) * (CANVAS_H / rect.height);
      let best = -1;
      let bestD = 20;
      for (let i = 0; i < motion.count(); i++) {
        const p = agentDrawPos(i);
        const d = Math.hypot(p.x - x, p.y - y);
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

