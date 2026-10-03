// 工程の紹介（最初の 64 拍）の時刻表。
// 紹介のボールはベルトコンベアの上を等速で運ばれ、各工程の機械の手前で一列に並んで
// 1 個ずつ処理される。ここでは「いつ・どこで」起きるかだけを決める純粋な定数と関数を置く
// （DOM・three.js・show/score.ts は import しない。score.ts と render/tourMotion.ts がここを読む）。
// 時刻の単位はすべてビート（60 BPM なので 1 拍 = 1 秒）で、絶対時刻（c.startBeat は使わない）。
import type { Candidate } from '../sim/types';

export const TOUR_SPAWN_BEAT = 4; // この拍のフィード要求 1 回分が紹介のボールになる

// 各工程で 1 個を処理する周期と、周期の中の割り振り
export const TOUR_CYCLE = 1.25; // 1 個あたりの拍数
export const TOUR_MOVE = 0.5; // 列が 1 つ進むのにかける拍数
export const TOUR_DWELL_IN = 0.25; // 機械の下に着いてから機械が当たるまで
export const TOUR_DWELL_OUT = 0.25; // 機械が当たってから動き出すまで
export const TOUR_SPEED = 2.5; // 工程の間を運ばれる速さ（ワールド単位 / 拍）

// 下の階のレイアウト（x 座標）。時刻の計算にも使うのでここに置く。
export const TOUR_X_PIPE = -16.2; // 紹介用パイプの口
export const TOUR_X_LAND = -15; // パイプから落ちてベルトに着く位置
export const TOUR_X_PRESS = -7.5; // フィルタのプレス
export const TOUR_X_SCRAP = -5.5; // 除外の扉と除外箱の中心
export const TOUR_X_SCORE = 2.5; // スコアリングの計測ゲート
export const TOUR_X_DIVERSITY = 12.2; // 多様性調整のしぼり機
export const TOUR_X_REJECT = 22; // 選抜の扉と落選箱の中心
export const TOUR_X_BELL = 25; // 通過のベル
export const TOUR_X_END = 29; // 発射台
export const TOUR_PITCH = 0.85; // 列の間隔（スコアリングまで）
export const TOUR_PITCH_WIDE = 1.1; // 列の間隔（スコアリングの後。ボールが大きくなるため）

// 候補取得: ボール k がパイプから出る時刻・ベルトに着く時刻
export const TOUR_EMERGE_T0 = 4.75; // emerge(k) = TOUR_EMERGE_T0 + 0.75 * k
export const TOUR_EMERGE_EVERY = 0.75;
export const TOUR_FALL = 0.75; // land(k) = emerge(k) + TOUR_FALL

// 各工程で順番 0 のボールに機械が当たる時刻。順番 n のボールは + TOUR_CYCLE * n
export const TOUR_FILTER_T0 = 13.5; // フィルタ（順番は k）
export const TOUR_SCORE_T0 = 25.5; // スコアリング（順番は j）
export const TOUR_DIVERSITY_T0 = 37.5; // 多様性調整（順番は j）
export const TOUR_SELECT_T0 = 48.5; // 選抜の扉（順番は j）
export const TOUR_BELL_AFTER = 1.5; // 選抜を通過したボールがベルを鳴らすのは扉の時刻 + これ
export const TOUR_FEED_T0 = 59.5; // 発射台から飛ぶ時刻（順番は i）
export const TOUR_FLY = 1.25; // 発射台からエージェントまで飛ぶ拍数
export const TOUR_DOOR_FALL = 0.5; // 扉が開いてから箱の口に入るまで

// ボール 1 個の紹介の時刻表。null は「その出来事が起きない」。
export interface TourTimes {
  emerge: number;
  land: number;
  filter: number; // プレスが当たる時刻
  scrapDoor: number | null; // フィルタで落ちるボールが除外の扉に着いて扉が開く時刻
  scrap: number | null; // 除外箱の口に入る時刻（scrapDoor + TOUR_DOOR_FALL）
  score: number | null; // 以下、フィルタで落ちたボールは null
  diversity: number | null;
  select: number | null; // 選抜の扉の上で判定される時刻（落選ならここで扉が開く）
  reject: number | null; // 落選箱の口に入る時刻（select + TOUR_DOOR_FALL）。落選のみ
  bell: number | null; // 通過のみ
  launch: number | null; // 発射台から飛ぶ時刻。通過のみ
  catch: number | null; // launch + TOUR_FLY。通過のみ
}

// c.tour が必要（なければ throw）。dropStage と tour の k/j/i だけから決める。
export function tourTimes(c: Candidate): TourTimes {
  if (!c.tour) throw new Error('tourTimes: c.tour がありません');
  const { k, j, i } = c.tour;
  const emerge = TOUR_EMERGE_T0 + TOUR_EMERGE_EVERY * k;
  const land = emerge + TOUR_FALL;
  const filter = TOUR_FILTER_T0 + TOUR_CYCLE * k;
  if (c.dropStage === 1) {
    // プレスを出てから扉の中心までベルトで運ばれて着く時刻
    const scrapDoor = filter + TOUR_DWELL_OUT + (TOUR_X_SCRAP - TOUR_X_PRESS) / TOUR_SPEED;
    return {
      emerge,
      land,
      filter,
      scrapDoor,
      scrap: scrapDoor + TOUR_DOOR_FALL,
      score: null,
      diversity: null,
      select: null,
      reject: null,
      bell: null,
      launch: null,
      catch: null,
    };
  }
  const score = TOUR_SCORE_T0 + TOUR_CYCLE * j;
  const diversity = TOUR_DIVERSITY_T0 + TOUR_CYCLE * j;
  const select = TOUR_SELECT_T0 + TOUR_CYCLE * j;
  if (c.dropStage === 4) {
    return {
      emerge,
      land,
      filter,
      scrapDoor: null,
      scrap: null,
      score,
      diversity,
      select,
      reject: select + TOUR_DOOR_FALL,
      bell: null,
      launch: null,
      catch: null,
    };
  }
  const launch = TOUR_FEED_T0 + TOUR_CYCLE * i;
  return {
    emerge,
    land,
    filter,
    scrapDoor: null,
    scrap: null,
    score,
    diversity,
    select,
    reject: null,
    bell: select + TOUR_BELL_AFTER,
    launch,
    catch: launch + TOUR_FLY,
  };
}

// 1 回分の候補に tour と doneBeat を付ける（配列の要素を書き換える）。
// 順番 k: フォロー内とフォロー外を交互に（in の slot 昇順、out の slot 昇順を
// in, out, in, out… と混ぜる。片方が尽きたら残りを続ける）。
// j: dropStage !== 1 のものを k の順に 0 から。i: dropStage === null のものを k の順に 0 から。
// doneBeat: 最後の出来事の時刻の floor（除外 = scrap、落選 = reject、通過 = catch）。
export function assignTour(batch: Candidate[]): void {
  const inn = batch
    .filter((c) => c.source === 'in')
    .sort((a, b) => a.slot - b.slot || a.id - b.id);
  const out = batch
    .filter((c) => c.source === 'out')
    .sort((a, b) => a.slot - b.slot || a.id - b.id);
  const order: Candidate[] = [];
  for (let a = 0, o = 0; a < inn.length || o < out.length; ) {
    if (a < inn.length) order.push(inn[a++]);
    if (o < out.length) order.push(out[o++]);
  }
  order.forEach((c, k) => {
    c.tour = { k, j: -1, i: -1 };
  });
  let j = 0;
  let i = 0;
  for (const c of order) {
    if (c.dropStage !== 1) c.tour!.j = j++;
    if (c.dropStage === null) c.tour!.i = i++;
  }
  for (const c of order) {
    const T = tourTimes(c);
    const last =
      c.dropStage === 1 ? T.scrap! : c.dropStage === 4 ? T.reject! : T.catch!;
    c.doneBeat = Math.floor(last);
  }
}
