// エージェントの興味の街の中での動き。興味ベクトルから目標位置を決め、
// ばね＋エージェント同士の反発＋ゆっくりしたふらつきで XZ 平面（床）を動かす。
// y 方向は拍の跳ね（kick / beatHop）だけが持ち上げる。シミュレーションの状態には触れない。
import type { World } from '../sim/types';
import { DISTRICT_CENTER, DISTRICT_R, districtPos, hash01 } from './stageLayout';

export interface AgentState {
  x: number;
  z: number;
  y: number; // 床からの持ち上がり（跳ね）
  vx: number;
  vz: number;
  vy: number;
  pop: number; // 反応があった直後の強調。0..1 で減衰する
}

const SPRING_K = 60;
const SPRING_D = 9;
const REPEL_DIST = 1.4; // 中心間がこれ未満だと反発する
const REPEL_K = 80;
const WANDER = 0.28; // ふらつきの幅
const GRAV = 14; // 跳ねの重力
const BOUND_R = DISTRICT_R - 0.2; // 街の円の内側に留める

export interface Vec2 {
  x: number;
  z: number;
}

// reset 時の初期位置。黄金角の螺旋で街の中心の周りに散らす。
export function initialAgentPos(i: number): Vec2 {
  const a = i * 2.399963229728653;
  const r = 0.6 + 0.3 * Math.sqrt(i);
  return {
    x: DISTRICT_CENTER.x + Math.cos(a) * r,
    z: DISTRICT_CENTER.z + Math.sin(a) * r,
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
    let sz = 0;
    let sw = 0;
    for (let j = 0; j < n; j++) {
      const w = Math.pow(Math.max(0, interest[j]), 1.5);
      const d = districtPos(j, n);
      sx += d.x * w;
      sz += d.z * w;
      sw += w;
    }
    const bx = sw > 0 ? sx / sw : DISTRICT_CENTER.x;
    const bz = sw > 0 ? sz / sw : DISTRICT_CENTER.z;
    return {
      x: bx + Math.sin(t * 0.55 + i * 2.17) * WANDER,
      z: bz + Math.cos(t * 0.47 + i * 1.71) * WANDER,
    };
  }

  const api: AgentMotion = {
    reset(count) {
      st.length = 0;
      for (let i = 0; i < count; i++) {
        const p = initialAgentPos(i);
        st.push({ x: p.x, z: p.z, y: 0, vx: 0, vz: 0, vy: 0, pop: 0 });
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
        s.vz += ((tg.z - s.z) * SPRING_K - s.vz * SPRING_D) * dt;
        s.pop *= Math.exp(-dt * 4);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = st[i];
          const b = st[j];
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let d = Math.hypot(dx, dz);
          if (d < 1e-3) {
            dx = hash01(i * 17 + j) - 0.5;
            dz = hash01(j * 13 + i) - 0.5;
            d = 1;
          }
          if (d < REPEL_DIST) {
            const f = ((REPEL_DIST - d) / d) * REPEL_K * dt;
            a.vx -= dx * f;
            a.vz -= dz * f;
            b.vx += dx * f;
            b.vz += dz * f;
          }
        }
      }
      for (const s of st) {
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        // 街の円の内側に留める
        const dx = s.x - DISTRICT_CENTER.x;
        const dz = s.z - DISTRICT_CENTER.z;
        const d = Math.hypot(dx, dz);
        if (d > BOUND_R) {
          s.x = DISTRICT_CENTER.x + (dx / d) * BOUND_R;
          s.z = DISTRICT_CENTER.z + (dz / d) * BOUND_R;
          s.vx = 0;
          s.vz = 0;
        }
        // 高さ方向の跳ね（重力で床に戻る）
        if (s.y > 0 || s.vy > 0) {
          s.vy -= GRAV * dt;
          s.y += s.vy * dt;
          if (s.y <= 0) {
            s.y = 0;
            s.vy = 0;
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
        s.vy += impulse;
        s.pop = 1;
      }
    },
    beatHop(seed) {
      for (let i = 0; i < st.length; i++) {
        st[i].vy += 0.9 * (0.75 + 0.5 * hash01(i * 7.3 + seed * 3.1));
        st[i].vx += (hash01(i * 3.7 + seed * 5.9) - 0.5) * 0.3;
      }
    },
  };
  return api;
}
