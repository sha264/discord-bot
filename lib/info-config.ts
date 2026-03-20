export type InfoEntry = {
  title: string;
  url: string;
  aliases?: string[];
};

const DEFAULT_INFO_MAP: Record<string, InfoEntry> = {
  stay: {
    title: "stay",
    url: "https://www.notion.so/27c910452e0a8036a0c8e2f55024732a",
    aliases: ["泊まり"]
  },
};

function normalizeTopic(input: string): string {
  return input.trim().toLowerCase();
}

export function getInfoMap(): Record<string, InfoEntry> {
  const fromEnv = process.env.INFO_MAP_JSON;
  if (!fromEnv) {
    return DEFAULT_INFO_MAP;
  }

  try {
    const parsed = JSON.parse(fromEnv) as Record<string, InfoEntry>;
    return parsed;
  } catch {
    return DEFAULT_INFO_MAP;
  }
}

export function resolveInfo(topic: string): { key: string; entry: InfoEntry } | null {
  const normalized = normalizeTopic(topic);
  const infoMap = getInfoMap();

  for (const [key, entry] of Object.entries(infoMap)) {
    if (normalizeTopic(key) === normalized) {
      return { key, entry };
    }

    if (entry.aliases?.some((alias) => normalizeTopic(alias) === normalized)) {
      return { key, entry };
    }
  }

  return null;
}
