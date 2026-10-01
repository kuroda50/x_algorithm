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

export const DEFAULT_AGENT_COUNT = 12;
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

// エージェント i は beat % REQUEST_INTERVAL === i % REQUEST_INTERVAL のビートにフィードを要求する
export const REQUEST_INTERVAL = 4;
export const CANDIDATES_IN = 4;
export const CANDIDATES_OUT = 4;
export const SELECT_K = 3;
export const IN_RECENT_POOL = 16; // フォロー内は、新しいこの件数の中から興味に近いものを選ぶ
export const RETRIEVAL_NOISE = 0.15; // 候補取得の順位に足すゆらぎ

// 反応 1 回で、その話題の興味が何割増えるか（learningRate に掛ける）
export const LEARN_LIKE = 0.2;
export const LEARN_REPOST = 0.3;
export const LEARN_REPLY = 0.4;
export const LEARN_IGNORE = 0.06; // 反応が 1 つもないときに減らす割合
export const FOLLOW_RATE = 0.3; // フォロー外にリプライ・リポストしたときにフォローする確率

export const PIPELINE_BEATS = 5; // 始発駅からエージェントまでの移動回数
export const MOVE_FRACTION = 0.75; // 1 拍のうち移動に使う割合。残りは駅で止まる

export const FEED_KEEP = 20;
export const METRICS_MIN_FEED = 12; // フィードがこの件数に満たないエージェントは指標に含めない
export const METRICS_KEEP = 240;

export const DEFAULT_PARAMS: Params = {
  wLike: 1,
  wReply: 9,
  wRepost: 2,
  diversity: 0.5,
  oonFactor: 0.75,
  learningRate: 0.08,
};

export const DEFAULT_BPM = 110;

// エージェントごとの色。Canvas と DOM の両方で同じ色を使う。
export function agentColor(index: number, total: number): string {
  const hue = Math.round((360 * index) / Math.max(1, total));
  return `hsl(${hue} 65% 55%)`;
}
