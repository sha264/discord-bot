import { redis } from "@/lib/redis";

export type InfoEntry = {
  topic: string;
  title: string;
  url: string;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
};

type StoredInfoEntry = Omit<InfoEntry, "aliases"> & { aliases?: string[] };

const INFO_TOPIC_SET_KEY = "infos:topics";
const DEFAULT_INFO_LIST_LIMIT = 20;
const MAX_INFO_LIST_LIMIT = 50;

function infoKey(topic: string): string {
  return `info:item:${topic}`;
}

function infoAliasKey(alias: string): string {
  return `info:alias:${alias}`;
}

function normalizeToken(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTopic(input: string): string {
  const normalized = normalizeToken(input);
  if (!normalized) {
    throw new Error("topic は必須です。");
  }
  return normalized;
}

function normalizeUrl(input: string): string {
  const url = input.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    throw new Error("url は http:// または https:// で始まる必要があります。");
  }
  return url;
}

function normalizeTitle(input: string | undefined, fallbackTopic: string): string {
  const title = (input ?? "").trim();
  return title || fallbackTopic;
}

function normalizeAliases(aliases: string[] | undefined, topic: string): string[] {
  const raw = aliases ?? [];
  const normalized = raw
    .flatMap((alias) => alias.split(","))
    .map((alias) => normalizeToken(alias))
    .filter((alias) => alias.length > 0 && alias !== topic);

  return [...new Set(normalized)];
}

function castInfoEntry(value: unknown): InfoEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<StoredInfoEntry>;
  if (typeof entry.topic !== "string" || typeof entry.title !== "string" || typeof entry.url !== "string") {
    return null;
  }

  return {
    topic: entry.topic,
    title: entry.title,
    url: entry.url,
    aliases: Array.isArray(entry.aliases) ? entry.aliases.filter((alias): alias is string => typeof alias === "string") : [],
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString()
  };
}

async function getInfoByTopicNormalized(normalizedTopic: string): Promise<InfoEntry | null> {
  const raw = await redis.get(infoKey(normalizedTopic));
  return castInfoEntry(raw);
}

export async function getInfoByTopic(topic: string): Promise<InfoEntry | null> {
  const normalizedTopic = normalizeTopic(topic);
  return getInfoByTopicNormalized(normalizedTopic);
}

export async function resolveInfo(topicOrAlias: string): Promise<InfoEntry | null> {
  const normalized = normalizeTopic(topicOrAlias);

  const byTopic = await getInfoByTopicNormalized(normalized);
  if (byTopic) {
    return byTopic;
  }

  const aliasedTopic = await redis.get<string>(infoAliasKey(normalized));
  if (!aliasedTopic) {
    return null;
  }

  return getInfoByTopicNormalized(aliasedTopic);
}

async function assertAliasAvailability(aliases: string[], ownerTopic: string): Promise<void> {
  await Promise.all(
    aliases.map(async (alias) => {
      const existingTopic = await redis.get<string>(infoAliasKey(alias));
      if (existingTopic && existingTopic !== ownerTopic) {
        throw new Error(`alias "${alias}" は topic "${existingTopic}" で使用中です。`);
      }

      if (alias !== ownerTopic) {
        const topicCollision = await getInfoByTopicNormalized(alias);
        if (topicCollision && topicCollision.topic !== ownerTopic) {
          throw new Error(`alias "${alias}" は既存 topic と衝突します。`);
        }
      }
    })
  );
}

export async function upsertInfo(params: {
  topic: string;
  title?: string;
  url: string;
  aliases?: string[];
}): Promise<{ entry: InfoEntry; created: boolean }> {
  const normalizedTopic = normalizeTopic(params.topic);
  const normalizedUrl = normalizeUrl(params.url);
  const normalizedAliases = normalizeAliases(params.aliases, normalizedTopic);

  await assertAliasAvailability(normalizedAliases, normalizedTopic);

  const now = new Date().toISOString();
  const existing = await getInfoByTopicNormalized(normalizedTopic);
  const oldAliases = existing?.aliases ?? [];
  const nextAliasSet = new Set(normalizedAliases);
  const aliasesToDelete = oldAliases.filter((alias) => !nextAliasSet.has(alias));

  const entry: InfoEntry = {
    topic: normalizedTopic,
    title: normalizeTitle(params.title, normalizedTopic),
    url: normalizedUrl,
    aliases: normalizedAliases,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await redis.set(infoKey(normalizedTopic), entry);
  await redis.sadd(INFO_TOPIC_SET_KEY, normalizedTopic);

  if (aliasesToDelete.length > 0) {
    await Promise.all(aliasesToDelete.map((alias) => redis.del(infoAliasKey(alias))));
  }

  if (normalizedAliases.length > 0) {
    await Promise.all(normalizedAliases.map((alias) => redis.set(infoAliasKey(alias), normalizedTopic)));
  }

  return { entry, created: !existing };
}

export async function listInfos(limit = DEFAULT_INFO_LIST_LIMIT): Promise<InfoEntry[]> {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_INFO_LIST_LIMIT) : DEFAULT_INFO_LIST_LIMIT;
  const topics = ((await redis.smembers(INFO_TOPIC_SET_KEY)) ?? []) as Array<string | number>;

  const entries = await Promise.all(
    topics.map(async (topicValue) => {
      const topic = String(topicValue);
      return getInfoByTopicNormalized(topic);
    })
  );

  return entries
    .filter((entry): entry is InfoEntry => Boolean(entry))
    .sort((a, b) => a.topic.localeCompare(b.topic))
    .slice(0, normalizedLimit);
}
