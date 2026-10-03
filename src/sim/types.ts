// シミュレーションと画面の間で共有する型。
// sim/ はビート単位で進む離散シミュレーションで、render/ audio/ ui/ はこの型だけを通して状態を読む。

export type TopicId = number; // 0..TOPICS.length-1

// 0:始発駅 1:フィルタ 2:スコアリング 3:多様性調整 4:選抜 5:エージェント
export type Stage = 0 | 1 | 2 | 3 | 4 | 5;

export type TopicShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'pentagon';

export interface Topic {
  name: string;
  shape: TopicShape;
  color: string;
}

export type Rng = () => number; // [0, 1)

export interface Author {
  id: number;
  name: string;
  topic: TopicId;
}

export interface Post {
  id: number;
  authorId: number;
  topic: TopicId;
  quality: number; // 0..1
  bad: boolean; // スパム。フィルタ駅で除外される
  createdBeat: number;
  engagements: number; // 全エージェントからの反応の累計
}

export interface Reactions {
  like: boolean;
  reply: boolean;
  repost: boolean;
}

export interface FeedItem {
  postId: number;
  topic: TopicId;
  authorId: number;
  source: 'in' | 'out'; // フォロー内 / フォロー外
  score: number; // 多様性調整後の値
  deliveredBeat: number;
  reactions: Reactions;
}

export interface Agent {
  id: number; // world.agents の添字と同じ
  name: string;
  interest: number[]; // 話題ごとの興味。合計 1
  follows: Set<number>; // authorId
  seen: Set<number>; // postId
  feed: FeedItem[]; // 新しい順。最大 FEED_KEEP 件
}

// 1 回のフィード要求で発射されるボール（投稿）1 個。
// 運命（どこで落ちるか・スコア）は発射した時点で決まり、描画と音は show/score.ts の
// 時刻表（timeline）に従って進める。発射位置は t0 = startBeat + slot / 4（16 分音符）。
//   ドラム t0+1 →（フィルタ落ちならシンバル t0+1.5 → スクラップ箱 t0+2 で終わり）
//   → ビブラフォン t0+2 → ベース t0+3
//   →（落選なら落とし穴 t0+4 → 落選箱 t0+4.5 で終わり）→ ベル t0+4 → キャッチ t0+5
export interface Candidate {
  id: number;
  agentId: number;
  postId: number;
  topic: TopicId;
  authorId: number;
  source: 'in' | 'out';
  startBeat: number; // 発射要求があったビート
  slot: number; // 0..3。拍の中の発射位置（16 分音符）。同じ要求・同じ source の中での順番
  pLike: number;
  pReply: number;
  pRepost: number;
  score: number; // スコアリングでの値（フィルタで落ちたものは 0）
  scoreNorm: number; // score を今の重みで取りうる最大値で割った値 0..1。フィルタで落ちたものは 0
  adjusted: number; // 多様性調整後の値
  rank: number; // 選抜での順位（adjusted の大きい順、0 始まり）。フィルタで落ちたものは -1
  dropStage: 1 | 4 | null; // 1:フィルタで除外 4:選抜で落選 null:フィードに届く
  dropReason: 'bad' | 'old' | 'rank' | null;
  // 工程の紹介で流すボールの印。show/tour.ts の assignTour / assignFlow が付ける。
  tour?: {
    k: number; // この回の中での順番 0..n-1（パイプから出る順）
    j: number; // フィルタを通過したものの中での順番 0..。フィルタで落ちたものは -1
    i: number; // 選抜を通過したものの中での順番 0..。それ以外は -1
    // 流し続ける方式（デモ・自由操作）のとき、パイプから出る拍（整数）。
    // 省略時は紹介の方式（工程ごとに列に並ぶ）。
    base?: number;
  };
  // 届く・落ちる出来事が起きる拍（整数）。省略時は今までどおり startBeat から決める。
  doneBeat?: number;
}

export interface Params {
  wLike: number; // 0..10
  wReply: number; // 0..10
  wRepost: number; // 0..10
  diversity: number; // 0..1。大きいほど同じ投稿者の連続を強く抑える
  oonFactor: number; // 0..1.5。フォロー外のスコアに掛ける係数
  learningRate: number; // 0..0.3。反応が興味に効く強さ
}

export interface Delivery {
  candidate: Candidate;
  item: FeedItem;
  followed: boolean; // この配信でエージェントが投稿者をフォローした
}

// stepBeat がビート b で返す出来事。
//   spawned:   ビート b で発射された候補（そのビートに要求したエージェント 1 体分）
//   dropped:   ビート b にシンバル・落とし穴へ当たる（除外・落選が確定する）候補
//   delivered: ビート b にエージェントが受け止める候補
// world の状態（興味・フィード）は stepBeat の時点で更新済み。
export interface BeatEvents {
  beat: number;
  spawned: Candidate[];
  dropped: Candidate[];
  delivered: Delivery[];
}

export interface MetricsPoint {
  beat: number;
  bubble: number; // 偏り指数 0..1
  similarity: number; // エージェント間の類似度 0..1
}

export interface Stats {
  posts: number; // 生成された投稿
  dropped: number; // フィルタで除外された候補
  reactions: number; // 反応（いいね・リプライ・リポスト）の累計
}

export interface World {
  seed: number;
  rng: Rng;
  beat: number; // 最後に処理したビート。初期値 0
  authors: Author[];
  posts: Map<number, Post>;
  agents: Agent[];
  candidates: Candidate[]; // 移動中のもの。届いた・落ちたものは 2 ビート後に取り除く
  metrics: MetricsPoint[]; // 時系列。最大 METRICS_KEEP 点
  stats: Stats;
  nextPostId: number;
  nextCandidateId: number;
}
