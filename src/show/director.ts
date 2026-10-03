// 発表の進行表。どの拍で・どこにカメラを寄せて・どの字幕を出すかを決める純粋なデータと関数。
// DOM にも AudioContext にも触れない。main.ts が拍の位置からここを引く。

// カメラが収める範囲（ワールド座標。x 右・y 上）
export interface ShowView {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Scene {
  id: string;
  startBeat: number; // この拍から始まる
  bpm: number;
  view: ShowView | null; // null は全体
  step: number | null; // 工程の番号 1..STEP_COUNT。工程の紹介でない場面は null
  title: string; // 大きい字幕
  caption: string; // 小さい字幕
  showBubble: boolean; // 偏り指数の数字を出すか
}

export const SCENES: readonly Scene[] = [
  {
    id: 'intro',
    startBeat: 0,
    bpm: 60,
    view: null,
    step: null,
    title: 'おすすめは、どう決まる？',
    caption: 'X のおすすめフィードの仕組みを、音で聴く。',
    showBubble: false,
  },
  {
    id: 'retrieve',
    startBeat: 4,
    bpm: 60,
    view: { x0: -17.5, x1: -4, y0: -2, y1: 17 },
    step: 1,
    title: '候補取得',
    caption: 'フォロー内とフォロー外から、投稿を集める。',
    showBubble: false,
  },
  {
    id: 'filter',
    startBeat: 12,
    bpm: 60,
    view: { x0: -14, x1: -3, y0: -4.5, y1: 13.5 },
    step: 2,
    title: 'フィルタ',
    caption: 'スパムと古い投稿は、ここで弾かれる。',
    showBubble: false,
  },
  {
    id: 'score',
    startBeat: 24,
    bpm: 60,
    view: { x0: -5, x1: 5, y0: -3.5, y1: 11 },
    step: 3,
    title: 'スコアリング',
    caption: '反応されそうな投稿ほど、高い音へ。',
    showBubble: false,
  },
  {
    id: 'diversity',
    startBeat: 36,
    bpm: 60,
    view: { x0: 3.5, x1: 12.5, y0: -3, y1: 8 },
    step: 4,
    title: '多様性調整',
    caption: '同じ人の投稿と、フォロー外の投稿は小さくなる。',
    showBubble: false,
  },
  {
    id: 'select',
    startBeat: 44,
    bpm: 60,
    view: { x0: 10, x1: 19.5, y0: -3.5, y1: 10 },
    step: 5,
    title: '選抜',
    caption: '上位 3 件だけが、ベルを鳴らして進む。',
    showBubble: false,
  },
  {
    id: 'feed',
    startBeat: 56,
    bpm: 60,
    view: { x0: 15, x1: 29, y0: -1.5, y1: 14.5 },
    step: 6,
    title: 'フィード',
    caption: '届いた投稿に反応すると、次のおすすめが変わる。',
    showBubble: false,
  },
  {
    id: 'ensemble',
    startBeat: 64,
    bpm: 110,
    view: null,
    step: null,
    title: '全部つなげると、曲になる。',
    caption: '最初は、みんな同じ白。',
    showBubble: false,
  },
  {
    id: 'drift',
    startBeat: 112,
    bpm: 126,
    view: null,
    step: null,
    title: '反応するたびに、色がつく。',
    caption: 'アルゴリズムは、好きなものをもっと届ける。',
    showBubble: true,
  },
  {
    id: 'bubble',
    startBeat: 176,
    bpm: 140,
    view: { x0: 14, x1: 30, y0: -4, y1: 15 },
    step: null,
    title: '同じ曲なのに、見ているものは違う。',
    caption: '同じ場所から始めた 8 人が、別々の色に分かれた。',
    showBubble: true,
  },
  {
    id: 'finale',
    startBeat: 248,
    bpm: 150,
    view: null,
    step: null,
    title: 'これが、フィルターバブル。',
    caption: '',
    showBubble: true,
  },
];

export const SHOW_END_BEAT = 280; // この拍で発表を終えて締めの画面へ
export const LEARN_START_BEAT = 64; // これより前は興味を動かさない（全員が白いまま）
export const SHOW_SEED = 3; // 発表用の世界の乱数シード（毎回同じ展開にする）
export const STEP_COUNT = 6; // 紹介する工程の数
export const TOUR_END_BEAT = 64; // 工程の紹介が終わる拍（ensemble の startBeat と同じ）
export const TOUR_REQUEST_EVERY = 4; // 紹介中は何拍に 1 回フィード要求するか

// ビート beat（整数。stepBeat がこれから処理する拍）でフィード要求をするか。
// 紹介中は (beat - 1) % TOUR_REQUEST_EVERY === 0 の拍だけ。TOUR_END_BEAT 以降は毎拍。
export function requestAt(beat: number): boolean {
  if (beat >= TOUR_END_BEAT) return true;
  return (beat - 1) % TOUR_REQUEST_EVERY === 0;
}

// beat にいる場面の SCENES の添字。範囲外は端に丸める（負は 0、終了後は最後）。
export function sceneIndexAt(beat: number): number {
  let i = 0;
  for (let k = 1; k < SCENES.length; k++) {
    if (SCENES[k].startBeat <= beat) i = k;
    else break;
  }
  return i;
}

export function sceneAt(beat: number): Scene {
  return SCENES[sceneIndexAt(beat)];
}

export function bpmAt(beat: number): number {
  return sceneAt(beat).bpm;
}

// LEARN_START_BEAT より前は 0、以降は normal。
export function learningRateAt(beat: number, normal: number): number {
  return beat < LEARN_START_BEAT ? 0 : normal;
}

// 0 拍から SHOW_END_BEAT までの秒数（場面ごとの bpm で積算）。
export function showSeconds(): number {
  let sec = 0;
  for (let i = 0; i < SCENES.length; i++) {
    const end = i + 1 < SCENES.length ? SCENES[i + 1].startBeat : SHOW_END_BEAT;
    sec += (end - SCENES[i].startBeat) * (60 / SCENES[i].bpm);
  }
  return sec;
}
