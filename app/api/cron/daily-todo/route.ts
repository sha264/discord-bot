import { sendDiscordWebhook } from "@/lib/discord";
import { redis } from "@/lib/redis";
import { formatDailyTodoMessage, listOpenTodos } from "@/lib/todos";
import { getJstDateKey } from "@/lib/time";

const LOCK_KEY = "cron:daily-todo:lock";
const LAST_SENT_KEY = "cron:daily-todo:last-sent-jst-date";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dateKey = getJstDateKey();
  const lastSent = await redis.get<string>(LAST_SENT_KEY);
  if (lastSent === dateKey) {
    return Response.json({ ok: true, skipped: true, reason: "already-sent", dateKey });
  }

  const lockValue = `${dateKey}:${crypto.randomUUID()}`;
  const acquired = await redis.set(LOCK_KEY, lockValue, { nx: true, ex: 300 });
  if (!acquired) {
    return Response.json({ ok: true, skipped: true, reason: "lock-exists", dateKey });
  }

  try {
    const todos = await listOpenTodos(50);
    const content = formatDailyTodoMessage(todos);
    await sendDiscordWebhook(content);
    await redis.set(LAST_SENT_KEY, dateKey);

    return Response.json({ ok: true, sent: true, count: todos.length, dateKey });
  } finally {
    await redis.del(LOCK_KEY);
  }
}
