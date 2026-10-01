// 話題ごとの図形と、反応アイコンのパス。パスを組むだけで fill/stroke は呼び出し側。
import type { TopicShape } from '../sim/types';

// 中心 (x, y)・半径 r の図形パスを組む。
export function shapePath(
  ctx: CanvasRenderingContext2D,
  shape: TopicShape,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
      break;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.9, y + r * 0.75);
      ctx.lineTo(x - r * 0.9, y + r * 0.75);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.8, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.8, y);
      ctx.closePath();
      break;
    case 'pentagon':
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      break;
  }
}

// リプライの印に使う吹き出し。中心 (x, y)、s は半幅の目安。
export function bubblePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.8);
  ctx.lineTo(x + s, y - s * 0.8);
  ctx.lineTo(x + s, y + s * 0.3);
  ctx.lineTo(x + s * 0.25, y + s * 0.3);
  ctx.lineTo(x - s * 0.1, y + s * 0.95);
  ctx.lineTo(x - s * 0.3, y + s * 0.3);
  ctx.lineTo(x - s, y + s * 0.3);
  ctx.closePath();
}
