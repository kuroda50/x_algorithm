import {
  AGENT_NAMES,
  AUTHOR_ON_TOPIC_RATE,
  AUTHORS_PER_TOPIC,
  BAD_RATE,
  FEED_KEEP,
  FOLLOW_RATE,
  INITIAL_FOLLOWS_PER_TOPIC,
  INITIAL_INTEREST_JITTER,
  INTEREST_FLOOR,
  LEARN_IGNORE,
  LEARN_LIKE,
  LEARN_REPLY,
  LEARN_REPOST,
  METRICS_KEEP,
  METRICS_MIN_FEED,
  PIPELINE_BEATS,
  POST_KEEP_AGE,
  POSTS_PER_BEAT,
  TOPICS,
} from './config';
import { computeMetrics } from './metrics';
import { runPipeline } from './pipeline';
import { createRng } from './rng';
import type {
  Agent,
  Author,
  BeatEvents,
  Candidate,
  Delivery,
  FeedItem,
  Params,
  Post,
  Reactions,
  World,
} from './types';

// 話題ごとの投稿者名の接頭辞（TOPICS の順に対応）。
const AUTHOR_PREFIX: Record<string, string> = {
  猫: 'neko',
  テック: 'tech',
  ニュース: 'news',
  ゲーム: 'game',
  料理: 'meshi',
};

// 下限 INTEREST_FLOOR で切ってから合計 1 に正規化する。
function normalizeInterest(interest: number[]): void {
  let sum = 0;
  for (let i = 0; i < interest.length; i++) {
    interest[i] = Math.max(INTEREST_FLOOR, interest[i]);
    sum += interest[i];
  }
  for (let i = 0; i < interest.length; i++) interest[i] /= sum;
}

function makePost(world: World, createdBeat: number): Post {
  const rng = world.rng;
  const author = world.authors[Math.floor(rng() * world.authors.length)];
  let topic = author.topic;
  if (rng() >= AUTHOR_ON_TOPIC_RATE) {
    topic = Math.floor(rng() * (TOPICS.length - 1));
    if (topic >= author.topic) topic++;
  }
  const post: Post = {
    id: world.nextPostId++,
    authorId: author.id,
    topic,
    quality: rng(),
    bad: rng() < BAD_RATE,
    createdBeat,
    engagements: 0,
  };
  world.posts.set(post.id, post);
  return post;
}

export function createWorld(seed: number, agentCount: number): World {
  const rng = createRng(seed);
  const authors: Author[] = [];
  for (let t = 0; t < TOPICS.length; t++) {
    const prefix = AUTHOR_PREFIX[TOPICS[t].name] ?? `t${t}`;
    for (let i = 0; i < AUTHORS_PER_TOPIC; i++) {
      authors.push({
        id: authors.length,
        name: `@${prefix}_${String(i + 1).padStart(2, '0')}`,
        topic: t,
      });
    }
  }
  const world: World = {
    seed,
    rng,
    beat: 0,
    authors,
    posts: new Map(),
    agents: [],
    candidates: [],
    metrics: [],
    stats: { posts: 0, dropped: 0, reactions: 0 },
    nextPostId: 0,
    nextCandidateId: 0,
  };
  for (let i = 0; i < agentCount; i++) {
    const interest = TOPICS.map(
      () => 1 / TOPICS.length + (rng() * 2 - 1) * INITIAL_INTEREST_JITTER,
    );
    normalizeInterest(interest);
    // 最初は全員が似たフィードになるよう、どの話題からも同じ人数をフォローする。
    const follows = new Set<number>();
    for (let t = 0; t < TOPICS.length; t++) {
      const pool = authors.filter((au) => au.topic === t).map((au) => au.id);
      for (let k = 0; k < Math.min(INITIAL_FOLLOWS_PER_TOPIC, pool.length); k++) {
        const j = k + Math.floor(rng() * (pool.length - k));
        const tmp = pool[k];
        pool[k] = pool[j];
        pool[j] = tmp;
        follows.add(pool[k]);
      }
    }
    const agent: Agent = {
      id: i,
      name: AGENT_NAMES[i % AGENT_NAMES.length],
      interest,
      follows,
      seen: new Set(),
      feed: [],
    };
    world.agents.push(agent);
  }
  // 最初のフィード要求で候補が足りるよう、数ビート分の投稿を用意しておく。
  const prefill = POSTS_PER_BEAT * 8;
  for (let i = 0; i < prefill; i++) makePost(world, -Math.floor(i / POSTS_PER_BEAT));
  return world;
}

// 候補が画面から消えてよいビート。届く: startBeat+5、フィルタ除外: +1、落選: +4。
// 紹介のボール（doneBeat 付き）は、届く・落ちる出来事が起きる拍を直接持つ。
function endBeat(c: Candidate): number {
  if (c.doneBeat !== undefined) return c.doneBeat;
  if (c.dropStage === 1) return c.startBeat + 1;
  if (c.dropStage === 4) return c.startBeat + 4;
  return c.startBeat + PIPELINE_BEATS;
}

// 候補をエージェントのフィードに届け、反応・学習・フォローを処理する。
function deliver(world: World, cand: Candidate, params: Params, beat: number): Delivery {
  const agent = world.agents[cand.agentId];
  const rng = world.rng;
  if (world.posts.has(cand.postId)) agent.seen.add(cand.postId);
  const reactions: Reactions = {
    like: rng() < cand.pLike,
    reply: rng() < cand.pReply,
    repost: rng() < cand.pRepost,
  };
  const item: FeedItem = {
    postId: cand.postId,
    topic: cand.topic,
    authorId: cand.authorId,
    source: cand.source,
    score: cand.adjusted,
    deliveredBeat: beat,
    reactions,
  };
  agent.feed.unshift(item);
  if (agent.feed.length > FEED_KEEP) agent.feed.length = FEED_KEEP;

  let gain = 0;
  if (reactions.like) gain += LEARN_LIKE;
  if (reactions.repost) gain += LEARN_REPOST;
  if (reactions.reply) gain += LEARN_REPLY;
  // 今の興味に比例して増減する（興味があるほど伸びやすい）。
  agent.interest[cand.topic] *= 1 + params.learningRate * (gain > 0 ? gain : -LEARN_IGNORE);
  normalizeInterest(agent.interest);

  let followed = false;
  if (
    cand.source === 'out' &&
    (reactions.reply || reactions.repost) &&
    !agent.follows.has(cand.authorId)
  ) {
    followed = rng() < FOLLOW_RATE;
    if (followed) agent.follows.add(cand.authorId);
  }

  const count =
    (reactions.like ? 1 : 0) + (reactions.reply ? 1 : 0) + (reactions.repost ? 1 : 0);
  const post = world.posts.get(cand.postId);
  if (post) post.engagements += count;
  world.stats.reactions += count;

  return { candidate: cand, item, followed };
}

// world.beat を 1 進め、そのビートの出来事を返す。
// request が false のビートはフィード要求（4）を行わない（工程の紹介中に流すボールを減らすため）。
export function stepBeat(world: World, params: Params, request = true): BeatEvents {
  const beat = ++world.beat;
  const events: BeatEvents = { beat, spawned: [], dropped: [], delivered: [] };

  // 1. 投稿の生成と、古すぎる投稿の掃除
  for (let i = 0; i < POSTS_PER_BEAT; i++) {
    makePost(world, beat);
    world.stats.posts++;
  }
  for (const [id, post] of world.posts) {
    if (beat - post.createdBeat > POST_KEEP_AGE) {
      world.posts.delete(id);
      // 消えた投稿はもう候補にならないので、既読の記録も消す（増え続けないように）。
      for (const agent of world.agents) agent.seen.delete(id);
    }
  }

  // 2. このビートの移動の終わりにエージェントへ届く候補
  for (const cand of world.candidates) {
    if (cand.dropStage === null && endBeat(cand) === beat) {
      events.delivered.push(deliver(world, cand, params, beat));
    }
  }

  // 3. このビートの移動の終わりに除外・落選する候補
  for (const cand of world.candidates) {
    if (cand.dropStage !== null && endBeat(cand) === beat) {
      events.dropped.push(cand);
      if (cand.dropStage === 1) world.stats.dropped++;
    }
  }

  // 4. フィード要求（1 拍につきエージェント 1 体。agents.length 拍で一巡する）
  if (request) {
    for (const agent of world.agents) {
      if (beat % world.agents.length !== agent.id) continue;
      const cands = runPipeline(world, agent, params);
      world.candidates.push(...cands);
      events.spawned.push(...cands);
    }
  }

  // 5. 指標の記録
  // 比べられるエージェントが 2 体そろうまでは記録しない（グラフに意味のない点を出さない）。
  let ready = 0;
  for (const agent of world.agents) if (agent.feed.length >= METRICS_MIN_FEED) ready++;
  if (ready >= 2) world.metrics.push(computeMetrics(world));
  if (world.metrics.length > METRICS_KEEP) {
    world.metrics.splice(0, world.metrics.length - METRICS_KEEP);
  }

  // 6. 終わってから 2 ビートたった候補を取り除く（消える演出を描く時間を残す）
  world.candidates = world.candidates.filter((c) => beat - endBeat(c) < 2);

  return events;
}
