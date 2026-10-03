import type { Params, Topic } from './types';

export const TOPICS: readonly Topic[] = [
  { name: '猫', shape: 'circle', color: '#1D9E75' },
  { name: 'テック', shape: 'square', color: '#7F77DD' },
  { name: 'ニュース', shape: 'triangle', color: '#D85A30' },
  { name: 'ゲーム', shape: 'diamond', color: '#D9A21B' },
  { name: '料理', shape: 'pentagon', color: '#D4537E' },
];

export const AUTHORS_PER_TOPIC = 6;
export const AUTHOR_ON_TOPIC_RATE = 0.8; // 投稿者が自分の話題で投稿する割合

export const POSTS_PER_BEAT = 6;
export const BAD_RATE = 0.12;
export const POST_MAX_AGE = 32; // ビート。これより古い投稿はフィルタで除外
export const POST_KEEP_AGE = 40; // ビート。これより古い投稿は消す

export const DEFAULT_AGENT_COUNT = 8;
export const MIN_AGENT_COUNT = 4;
export const MAX_AGENT_COUNT = 24;
export const AGENT_NAMES: readonly string[] = [
  'ハル', 'ソラ', 'ミオ', 'リク', 'ユイ', 'カイ', 'アオ', 'ナギ',
  'レン', 'ヒナ', 'トワ', 'メイ', 'ジン', 'サク', 'ルイ', 'コウ',
  'ノア', 'エマ', 'タク', 'スズ', 'イオ', 'ニコ', 'ケイ', 'ミツ',
];

export const INITIAL_FOLLOWS_PER_TOPIC = 2; // 最初は話題ごとに同じ人数をフォローする
export const INITIAL_INTEREST_JITTER = 0.015;
export const INTEREST_FLOOR = 0.01;

// フィード要求は 1 拍につきエージェント 1 体（beat % agents.length === agent.id）。
// 1 拍にフォロー内・フォロー外 4 個ずつ発射され、16 分音符ごとに楽器に当たる。
export const CANDIDATES_IN = 4;
export const CANDIDATES_OUT = 4;
export const SELECT_K = 3;
export const IN_RECENT_POOL = 16; // フォロー内は、新しいこの件数の中から興味に近いものを選ぶ
export const RETRIEVAL_NOISE = 0.15; // 候補取得の順位に足すゆらぎ

// 反応 1 回で、その話題の興味が何割増えるか（learningRate に掛ける）。
// ベルトで 1 個ずつ処理すると届く件数が少ないので、1 回の効きを強くしてある
export const LEARN_LIKE = 2.4;
export const LEARN_REPOST = 3.6;
export const LEARN_REPLY = 4.8;
export const LEARN_IGNORE = 0.72; // 反応が 1 つもないときに減らす割合
export const FOLLOW_RATE = 0.3; // フォロー外にリプライ・リポストしたときにフォローする確率

export const PIPELINE_BEATS = 5; // 発射からエージェントが受け止めるまでの拍数

export const FEED_KEEP = 20;
export const METRICS_MIN_FEED = 3; // フィードがこの件数に満たないエージェントは指標に含めない
export const METRICS_KEEP = 240;

export const DEFAULT_PARAMS: Params = {
  wLike: 1,
  wReply: 9,
  wRepost: 2,
  diversity: 0.5,
  oonFactor: 0.75,
  learningRate: 0.16,
};

export const DEFAULT_BPM = 90;

// エージェントごとの色。Canvas と DOM の両方で同じ色を使う。
export function agentColor(index: number, total: number): string {
  const hue = Math.round((360 * index) / Math.max(1, total));
  return `hsl(${hue} 65% 55%)`;
}
