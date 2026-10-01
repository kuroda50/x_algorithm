import type { MetricsPoint, World } from '../sim/types';

// 折れ線の色（ライト/ダーク両方で読める 2 色）
export const CHART_COLORS = { bubble: '#D85A30', similarity: '#378ADD' } as const;
const CSS_H = 170;
const PAD_L = 26;
const PAD_R = 92;
const PAD_T = 8;
const PAD_B = 16;
const LABEL_GAP = 14;

// 2 つのラベルの y 座標が近すぎるとき、順序を保ったまま minGap 以上に離す。
// a <= b であること。[lo, hi] の範囲に収める。
export function spreadLabels(
  a: number,
  b: number,
  minGap: number,
  lo: number,
  hi: number,
): [number, number] {
  if (b - a >= minGap) return [a, b];
  const mid = (a + b) / 2;
  let na = mid - minGap / 2;
  let nb = mid + minGap / 2;
  if (na < lo) {
    na = lo;
    nb = lo + minGap;
  }
  if (nb > hi) {
    nb = hi;
    na = hi - minGap;
  }
  return [na, nb];
}

// metrics のビートをプロット x 座標に変換する。点が 1 つしかないときは x0 === x1。
export function xScale(
  points: readonly MetricsPoint[],
  plotW: number,
  padL: number,
): (beat: number) => number {
  const x0 = points[0]?.beat ?? 0;
  const x1 = points[points.length - 1]?.beat ?? 1;
  const span = x1 - x0;
  return (beat) => (span > 0 ? padL + ((beat - x0) / span) * plotW : padL + plotW / 2);
}

export interface Chart {
  // ビートごとに呼ぶ
  update(world: World): void;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function createChart(el: HTMLElement): Chart {
  const title = document.createElement('h2');
  title.className = 'ch-title';
  title.textContent = 'フィードの偏り';
  const desc = document.createElement('p');
  desc.className = 'ch-desc';
  desc.textContent =
    '偏り指数が上がり、類似度が下がるほど、人ごとにフィードが分かれている。';
  const cv = document.createElement('canvas');
  cv.className = 'ch-canvas';
  el.append(title, desc, cv);
  const ctx = cv.getContext('2d');
  if (!ctx) return { update() {} };

  let points: readonly MetricsPoint[] = [];

  function draw(): void {
    if (!ctx) return;
    const w = cv.clientWidth;
    const h = CSS_H;
    if (w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    const textCol = cssVar('--text-muted', '#888');
    const gridCol = cssVar('--border', '#ddd');
    const yFor = (v: number) => PAD_T + (1 - v) * plotH;

    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;
    for (const gy of [0, 0.5, 1]) {
      const y = yFor(gy);
      ctx.strokeStyle = gridCol;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(w - PAD_R, y);
      ctx.stroke();
      ctx.fillStyle = textCol;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(gy), PAD_L - 5, y);
    }
    if (points.length === 0) return;

    const xAt = xScale(points, plotW, PAD_L);
    const drawLine = (key: 'bubble' | 'similarity', color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xAt(p.beat);
        const y = yFor(p[key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    drawLine('bubble', CHART_COLORS.bubble);
    drawLine('similarity', CHART_COLORS.similarity);

    const lastP = points[points.length - 1];
    const labelX = w - PAD_R + 8;
    const yB = yFor(lastP.bubble);
    const yS = yFor(lastP.similarity);
    const bubbleIsUpper = yB <= yS;
    const [up, lo2] = spreadLabels(
      bubbleIsUpper ? yB : yS,
      bubbleIsUpper ? yS : yB,
      LABEL_GAP,
      PAD_T + 6,
      h - PAD_B - 4,
    );
    const label = (text: string, color: string, y: number) => {
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, labelX, y);
    };
    label(`偏り指数 ${lastP.bubble.toFixed(2)}`, CHART_COLORS.bubble, bubbleIsUpper ? up : lo2);
    label(`類似度 ${lastP.similarity.toFixed(2)}`, CHART_COLORS.similarity, bubbleIsUpper ? lo2 : up);
  }

  new ResizeObserver(draw).observe(el);

  return {
    update(world: World) {
      points = world.metrics;
      draw();
    },
  };
}
