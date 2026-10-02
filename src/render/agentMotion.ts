// エージェントの興味の街の中での動き。興味ベクトルから目標位置を決め、
// ばね＋エージェント同士の反発＋ゆっくりしたふらつきで XY 平面を動かす。
// hop は拍の跳ね（kick / beatHop が持ち上げ、描画時に y に足す）。
// シミュレーションの状態には触れない。
import type { World } from '../sim/types';
import { DISTRICT_CENTER, DISTRICT_R, districtPos, hash01 } from './stageLayout';

export interface AgentState {
  x: number;
  y: number; // 街の中での位置
  hop: number; // 跳ねによる持ち上がり（描画時に y に足す）
  vx: number;
  vy: number;
  vhop: number;
  pop: number; // 反応があった直後の強調。0..1 で減衰する
}

const SPRING_K = 60;
const SPRING_D = 9;
const REPEL_DIST = 1.75; // 中心間がこれ未満だと反発する
const REPEL_K = 160;
const WANDER = 0.28; // ふらつきの幅
const GRAV = 14; // 跳ねの重力
const BOUND_R = DISTRICT_R - 0.2; // 街の円の内側に留める

export interface Vec2 {
  x: number;
  y: number;
}

// reset 時の初期位置。黄金角の螺旋で街の中心の周りに散らす。
export function initialAgentPos(i: number): Vec2 {
  const a = i * 2.399963229728653;
  const r = 0.9 + 0.55 * Math.sqrt(i);
  return {
    x: DISTRICT_CENTER.x + Math.cos(a) * r,
    y: DISTRICT_CENTER.y + Math.sin(a) * r,
  };
}

export interface AgentMotion {
  reset(count: number): void;
  update(world: World, dt: number): void;
  pos(i: number): AgentState | undefined;
  count(): number;
  kick(i: number, impulse: number): void;
  beatHop(seed: number): void;
}

export function createAgentMotion(): AgentMotion {
  const st: AgentState[] = [];
  let t = 0;

  // 興味ベクトル（interest^1.5 を正規化）で地区を重み付き平均し、ゆっくりしたふらつきを足す。
  function target(i: number, interest: number[]): Vec2 {
    const n = interest.length;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let j = 0; j < n; j++) {
      const w = Math.pow(Math.max(0, interest[j]), 1.5);
      const d = districtPos(j, n);
      sx += d.x * w;
      sy += d.y * w;
      sw += w;
    }
    const bx = sw > 0 ? sx / sw : DISTRICT_CENTER.x;
    const by = sw > 0 ? sy / sw : DISTRICT_CENTER.y;
    return {
      x: bx + Math.sin(t * 0.55 + i * 2.17) * WANDER,
      y: by + Math.cos(t * 0.47 + i * 1.71) * WANDER,
    };
  }

  const api: AgentMotion = {
    reset(count) {
      st.length = 0;
      for (let i = 0; i < count; i++) {
        const p = initialAgentPos(i);
        st.push({ x: p.x, y: p.y, hop: 0, vx: 0, vy: 0, vhop: 0, pop: 0 });
      }
    },
    update(world, dt) {
      dt = Math.min(Math.max(dt, 0), 0.05);
      t += dt;
      const n = world.agents.length;
      if (st.length !== n) api.reset(n);
      for (let i = 0; i < n; i++) {
        const s = st[i];
        const tg = target(i, world.agents[i].interest);
        s.vx += ((tg.x - s.x) * SPRING_K - s.vx * SPRING_D) * dt;
        s.vy += ((tg.y - s.y) * SPRING_K - s.vy * SPRING_D) * dt;
        s.pop *= Math.exp(-dt * 4);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = st[i];
          const b = st[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d < 1e-3) {
            dx = hash01(i * 17 + j) - 0.5;
            dy = hash01(j * 13 + i) - 0.5;
            d = 1;
          }
          if (d < REPEL_DIST) {
            const f = ((REPEL_DIST - d) / d) * REPEL_K * dt;
            a.vx -= dx * f;
            a.vy -= dy * f;
            b.vx += dx * f;
            b.vy += dy * f;
          }
        }
      }
      for (const s of st) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        // 街の円の内側に留める
        const dx = s.x - DISTRICT_CENTER.x;
        const dy = s.y - DISTRICT_CENTER.y;
        const d = Math.hypot(dx, dy);
        if (d > BOUND_R) {
          s.x = DISTRICT_CENTER.x + (dx / d) * BOUND_R;
          s.y = DISTRICT_CENTER.y + (dy / d) * BOUND_R;
          s.vx = 0;
          s.vy = 0;
        }
        // 跳ね（重力で元の高さに戻る）
        if (s.hop > 0 || s.vhop > 0) {
          s.vhop -= GRAV * dt;
          s.hop += s.vhop * dt;
          if (s.hop <= 0) {
            s.hop = 0;
            s.vhop = 0;
          }
        }
      }
    },
    pos(i) {
      return st[i];
    },
    count() {
      return st.length;
    },
    kick(i, impulse) {
      const s = st[i];
      if (s) {
        s.vhop += impulse;
        s.pop = 1;
      }
    },
    beatHop(seed) {
      for (let i = 0; i < st.length; i++) {
        st[i].vhop += 0.9 * (0.75 + 0.5 * hash01(i * 7.3 + seed * 3.1));
        st[i].vx += (hash01(i * 3.7 + seed * 5.9) - 0.5) * 0.3;
      }
    },
  };
  return api;
}
