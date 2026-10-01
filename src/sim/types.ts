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

// 1 回のフィード要求で流れる投稿 1 件。
// 運命（どこで落ちるか・スコア）は要求した時点で決まり、画面はそれを 5 ビートかけて見せる。
//   startBeat + k のビートで、駅 k-1 から駅 k へ移動する（k = 1..5）。
//   移動はビートの前半 0.75 拍で終わり、到着の演出はビート位置 startBeat + k + 0.75 で起きる。
export interface Candidate {
  id: number;
  agentId: number;
  postId: number;
  topic: TopicId;
  authorId: number;
  source: 'in' | 'out';
  startBeat: number; // 始発駅に現れたビート
  pLike: number;
  pReply: number;
  pRepost: number;
  score: number; // スコアリング駅での値（フィルタで落ちたものは 0）
  adjusted: number; // 多様性調整後の値
  dropStage: 1 | 4 | null; // 1:フィルタで除外 4:選抜で落選 null:フィードに届く
  dropReason: 'bad' | 'old' | 'rank' | null;
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
//   spawned:   ビート b で始発駅に現れた候補
//   dropped:   ビート b の移動の終わり（b + 0.75）に除外・落選する候補
//   delivered: ビート b の移動の終わり（b + 0.75）にエージェントへ届く候補
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
