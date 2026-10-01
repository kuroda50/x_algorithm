// エージェントの画面上の動き。興味ベクトルから目標位置を決め、ばね＋反発＋ふらつきで動かす。
// シミュレーションの状態には触れず、見た目のための状態だけを持つ。
import type { World } from '../sim/types';
import { DISTRICT_CENTER, districtPos, hash01, type Pt } from './layout';

export interface AgentState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pop: number; // 反応があった直後の強調。0..1 で減衰する
}

const SPRING_K = 60;
const SPRING_D = 9;
const REPEL_DIST = 46; // 中心間がこれ未満だと反発する
const REPEL_K = 140;
const BOUNDS = { x0: 695, y0: 75, x1: 1245, y1: 650 };

// reset 時の初期位置。黄金角の螺旋で中心の周りに散らす。
export function initialAgentPos(i: number): Pt {
  const a = i * 2.399963229728653;
  const r = 22 + 10 * Math.sqrt(i);
  return {
    x: DISTRICT_CENTER.x + Math.cos(a) * r,
    y: DISTRICT_CENTER.y + Math.sin(a) * r * 0.7,
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
  function target(i: number, interest: number[]): Pt {
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
      x: bx + Math.sin(t * 0.55 + i * 2.17) * 9,
      y: by + Math.cos(t * 0.47 + i * 1.71) * 9,
    };
  }

  const api: AgentMotion = {
    reset(count) {
      st.length = 0;
      for (let i = 0; i < count; i++) {
        st.push({ ...initialAgentPos(i), vx: 0, vy: 0, pop: 0 });
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
        if (s.x < BOUNDS.x0) {
          s.x = BOUNDS.x0;
          s.vx = 0;
        } else if (s.x > BOUNDS.x1) {
          s.x = BOUNDS.x1;
          s.vx = 0;
        }
        if (s.y < BOUNDS.y0) {
          s.y = BOUNDS.y0;
          s.vy = 0;
        } else if (s.y > BOUNDS.y1) {
          s.y = BOUNDS.y1;
          s.vy = 0;
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
        s.vy -= impulse;
        s.pop = 1;
      }
    },
    beatHop(seed) {
      for (let i = 0; i < st.length; i++) {
        st[i].vy -= 34 * (0.75 + 0.5 * hash01(i * 7.3 + seed * 3.1));
        st[i].vx += (hash01(i * 3.7 + seed * 5.9) - 0.5) * 22;
      }
    },
  };
  return api;
}
