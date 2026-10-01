import {
  CANDIDATES_IN,
  CANDIDATES_OUT,
  IN_RECENT_POOL,
  POST_MAX_AGE,
  RETRIEVAL_NOISE,
  SELECT_K,
  TOPICS,
} from './config';
import type { Agent, Candidate, Params, Post, TopicId, World } from './types';

// パイプラインを通る候補。Candidate に加えて元の Post を持つ（フィルタ・スコアリングが参照する）。
export interface PipeItem {
  cand: Candidate;
  post: Post;
}

// 候補取得の結果。投稿と、どの始発駅から来たか。
export interface RetrievedPost {
  post: Post;
  source: 'in' | 'out';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 駅0: 候補取得。
// フォロー内は、未読の新しい IN_RECENT_POOL 件の中から 興味[話題] + ノイズ の大きい順に CANDIDATES_IN 件
// （実際の X もフォロー内を大量に取ってから軽いランカーで絞る）。
// フォロー外は、未読を 興味[話題] + ノイズ の大きい順に CANDIDATES_OUT 件。
// 同じエージェント向けにすでに移動中の投稿は除く。
export function retrieveCandidates(world: World, agent: Agent): RetrievedPost[] {
  const flying = new Set<number>();
  for (const c of world.candidates) {
    if (c.agentId === agent.id) flying.add(c.postId);
  }
  const key = (post: Post) => agent.interest[post.topic] + RETRIEVAL_NOISE * world.rng();
  const byKey = (a: { post: Post; key: number }, b: { post: Post; key: number }) =>
    b.key - a.key || b.post.id - a.post.id;
  const inn: Post[] = [];
  const out: { post: Post; key: number }[] = [];
  for (const post of world.posts.values()) {
    if (agent.seen.has(post.id) || flying.has(post.id)) continue;
    if (agent.follows.has(post.authorId)) inn.push(post);
    else out.push({ post, key: key(post) });
  }
  inn.sort((a, b) => b.id - a.id);
  const recent = inn.slice(0, IN_RECENT_POOL).map((post) => ({ post, key: key(post) }));
  recent.sort(byKey);
  out.sort(byKey);
  return [
    ...recent.slice(0, CANDIDATES_IN).map((e) => ({ post: e.post, source: 'in' as const })),
    ...out.slice(0, CANDIDATES_OUT).map((e) => ({ post: e.post, source: 'out' as const })),
  ];
}

// 駅1: フィルタ。除外理由を返す。通過なら null。
export function checkFilter(post: Post, beat: number): 'bad' | 'old' | null {
  if (post.bad) return 'bad';
  if (beat - post.createdBeat > POST_MAX_AGE) return 'old';
  return null;
}

export function filterStage(items: PipeItem[], beat: number): void {
  for (const it of items) {
    const reason = checkFilter(it.post, beat);
    if (reason) {
      it.cand.dropStage = 1;
      it.cand.dropReason = reason;
    }
  }
}

// 駅2: スコアリング。投稿 1 件の予測確率と重み付きスコアを返す。
export function scorePost(
  interest: number[],
  topic: TopicId,
  quality: number,
  params: Params,
): { pLike: number; pReply: number; pRepost: number; score: number } {
  const aff = clamp((interest[topic] * TOPICS.length) / 2, 0, 1);
  const pLike = aff * (0.4 + 0.6 * quality);
  const pReply = 0.35 * aff * quality;
  const pRepost = 0.5 * aff * quality;
  const score = params.wLike * pLike + params.wReply * pReply + params.wRepost * pRepost;
  return { pLike, pReply, pRepost, score };
}

export function scoreStage(items: PipeItem[], interest: number[], params: Params): void {
  for (const it of items) {
    if (it.cand.dropStage !== null) continue;
    const s = scorePost(interest, it.post.topic, it.post.quality, params);
    it.cand.pLike = s.pLike;
    it.cand.pReply = s.pReply;
    it.cand.pRepost = s.pRepost;
    it.cand.score = s.score;
  }
}

// 駅3: 多様性調整。スコアの高い順に同じ投稿者の n 件目（0 始まり）へ (1-diversity)^n を掛け、
// フォロー外には oonFactor を掛ける。結果は cand.adjusted。
export function applyDiversity(cands: Candidate[], params: Params): void {
  const alive = cands
    .filter((c) => c.dropStage === null)
    .sort((a, b) => b.score - a.score || a.id - b.id);
  const count = new Map<number, number>();
  for (const c of alive) {
    const n = count.get(c.authorId) ?? 0;
    count.set(c.authorId, n + 1);
    c.adjusted =
      c.score * Math.pow(1 - params.diversity, n) * (c.source === 'out' ? params.oonFactor : 1);
  }
}

// 駅4: 選抜。adjusted の上位 SELECT_K 件だけが通過し、残りは dropStage=4。
export function selectTopK(cands: Candidate[]): void {
  const alive = cands
    .filter((c) => c.dropStage === null)
    .sort((a, b) => b.adjusted - a.adjusted || a.id - b.id);
  for (let i = SELECT_K; i < alive.length; i++) {
    alive[i].dropStage = 4;
    alive[i].dropReason = 'rank';
  }
}

// エージェント 1 体のフィード要求を処理し、候補とその運命を返す（startBeat は world.beat）。
export function runPipeline(world: World, agent: Agent, params: Params): Candidate[] {
  const items: PipeItem[] = retrieveCandidates(world, agent).map((r) => ({
    post: r.post,
    cand: {
      id: world.nextCandidateId++,
      agentId: agent.id,
      postId: r.post.id,
      topic: r.post.topic,
      authorId: r.post.authorId,
      source: r.source,
      startBeat: world.beat,
      pLike: 0,
      pReply: 0,
      pRepost: 0,
      score: 0,
      adjusted: 0,
      dropStage: null,
      dropReason: null,
    },
  }));
  filterStage(items, world.beat);
  // フィルタで落ちた投稿は既読扱いにする。そうしないと次の要求でも同じ投稿が候補の枠を埋め続ける。
  for (const it of items) if (it.cand.dropStage === 1) agent.seen.add(it.post.id);
  scoreStage(items, agent.interest, params);
  const cands = items.map((it) => it.cand);
  applyDiversity(cands, params);
  selectTopK(cands);
  return cands;
}
