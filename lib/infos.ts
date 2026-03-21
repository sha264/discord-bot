import { redis } from "@/lib/redis";

export type InfoEntry = {
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

const INFO_TITLE_SET_KEY = "infos:titles";
const INFO_DELETE_TOKEN_PREFIX_KEY = "infos:delete-token:";
const DEFAULT_INFO_LIST_LIMIT = 20;
const MAX_INFO_LIST_LIMIT = 50;
const INFO_DELETE_TOKEN_EX_SECONDS = 60 * 60;

function infoKey(normalizedTitle: string): string {
  return `info:item:${normalizedTitle}`;
}

function infoDeleteTokenKey(token: string): string {
  return `${INFO_DELETE_TOKEN_PREFIX_KEY}${token}`;
}

function normalizeToken(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeDisplayTitle(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("title は必須です。");
  }
  return normalized;
}

function normalizeTitleKey(input: string): string {
  return normalizeToken(normalizeDisplayTitle(input));
}

function normalizeUrl(input: string): string {
  const url = input.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    throw new Error("url は http:// または https:// で始まる必要があります。");
  }
  return url;
}

function castInfoEntry(value: unknown): InfoEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<InfoEntry>;
  if (typeof entry.title !== "string" || typeof entry.url !== "string") {
    return null;
  }

  const now = new Date().toISOString();
  return {
    title: entry.title,
    url: entry.url,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now
  };
}

async function getInfoByTitleKey(normalizedTitle: string): Promise<InfoEntry | null> {
  const raw = await redis.get(infoKey(normalizedTitle));
  return castInfoEntry(raw);
}

export async function getInfoByTitle(title: string): Promise<InfoEntry | null> {
  const normalizedTitle = normalizeTitleKey(title);
  return getInfoByTitleKey(normalizedTitle);
}

export async function resolveInfo(title: string): Promise<InfoEntry | null> {
  const normalized = normalizeTitleKey(title);
  return getInfoByTitleKey(normalized);
}

export async function upsertInfo(params: {
  title: string;
  url: string;
}): Promise<{ entry: InfoEntry; created: boolean }> {
  const normalizedTitle = normalizeTitleKey(params.title);
  const displayTitle = normalizeDisplayTitle(params.title);
  const normalizedUrl = normalizeUrl(params.url);

  const now = new Date().toISOString();
  const existing = await getInfoByTitleKey(normalizedTitle);

  const entry: InfoEntry = {
    title: displayTitle,
    url: normalizedUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await redis.set(infoKey(normalizedTitle), entry);
  await redis.sadd(INFO_TITLE_SET_KEY, normalizedTitle);

  return { entry, created: !existing };
}

export async function deleteInfo(title: string): Promise<InfoEntry | null> {
  const normalizedTitle = normalizeTitleKey(title);
  const existing = await getInfoByTitleKey(normalizedTitle);
  if (!existing) {
    return null;
  }

  await Promise.all([
    redis.del(infoKey(normalizedTitle)),
    redis.srem(INFO_TITLE_SET_KEY, normalizedTitle)
  ]);

  return existing;
}

export async function createInfoDeleteToken(title: string): Promise<string> {
  const normalizedTitle = normalizeTitleKey(title);
  const token = crypto.randomUUID().replace(/-/g, "");
  await redis.set(infoDeleteTokenKey(token), normalizedTitle, { ex: INFO_DELETE_TOKEN_EX_SECONDS });
  return token;
}

export async function deleteInfoByToken(token: string): Promise<InfoEntry | null> {
  const tokenValue = token.trim();
  if (!tokenValue) {
    return null;
  }

  const normalizedTitle = await redis.get<string>(infoDeleteTokenKey(tokenValue));
  if (!normalizedTitle) {
    return null;
  }

  const existing = await getInfoByTitleKey(normalizedTitle);
  if (!existing) {
    await redis.del(infoDeleteTokenKey(tokenValue));
    return null;
  }

  await Promise.all([
    redis.del(infoKey(normalizedTitle)),
    redis.srem(INFO_TITLE_SET_KEY, normalizedTitle),
    redis.del(infoDeleteTokenKey(tokenValue))
  ]);

  return existing;
}

export async function listInfos(limit = DEFAULT_INFO_LIST_LIMIT): Promise<InfoEntry[]> {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_INFO_LIST_LIMIT) : DEFAULT_INFO_LIST_LIMIT;
  const titles = ((await redis.smembers(INFO_TITLE_SET_KEY)) ?? []) as Array<string | number>;

  const entries = await Promise.all(
    titles.map(async (titleValue) => {
      const title = String(titleValue);
      return getInfoByTitleKey(title);
    })
  );

  return entries
    .filter((entry): entry is InfoEntry => Boolean(entry))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, normalizedLimit);
}
