// エージェントの見た目を興味ベクトルから決める純粋な関数。
// 最初は全員が白で、興味が偏るにつれて話題の色に染まっていく
// （これがフィードの偏りの表示になる）。
import { clamp01 } from './stageLayout';

export const TINT_FULL = 0.5; // 最大の話題がこの割合を超えると話題の色そのもの

// 興味ベクトルから「どの話題の色に、どれだけ染まるか」を返す。
// amount = 0 は白、1 は話題の色そのもの。空配列・合計 0 でも NaN にしない。
export function interestTint(interest: number[]): { topic: number; amount: number } {
  const n = interest.length;
  if (n === 0) return { topic: 0, amount: 0 };
  let sum = 0;
  let max = -Infinity;
  let topic = 0;
  for (let i = 0; i < n; i++) {
    sum += interest[i];
    if (interest[i] > max) {
      max = interest[i];
      topic = i;
    }
  }
  if (!(sum > 0)) return { topic: 0, amount: 0 };
  const m = max / sum;
  const den = TINT_FULL - 1 / n;
  const amount = den > 0 ? clamp01((m - 1 / n) / den) : m > 1 / n ? 1 : 0;
  return { topic, amount };
}
