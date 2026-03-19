import { DISCORD_INTERACTION_RESPONSE_TYPE, DISCORD_MESSAGE_FLAGS, verifyDiscordRequest } from "@/lib/discord";
import { resolveInfo } from "@/lib/info-config";
import { createTodo, formatTodoList, listTodos, markTodoDone } from "@/lib/todos";

type DiscordCommandOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
};

type DiscordInteraction = {
  type: number;
  data?: {
    name?: string;
    options?: DiscordCommandOption[];
  };
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function getOptionValue<T extends string | number | boolean>(interaction: DiscordInteraction, name: string): T | undefined {
  const option = interaction.data?.options?.find((item) => item.name === name);
  return option?.value as T | undefined;
}

function ephemeralMessage(content: string): Response {
  return jsonResponse({
    type: DISCORD_INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: DISCORD_MESSAGE_FLAGS.EPHEMERAL
    }
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!verifyDiscordRequest(signature, timestamp, rawBody)) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  if (interaction.type === 1) {
    return jsonResponse({ type: DISCORD_INTERACTION_RESPONSE_TYPE.PONG });
  }

  if (interaction.type !== 2) {
    return ephemeralMessage("未対応の interaction type です。");
  }

  const commandName = interaction.data?.name;

  try {
    if (commandName === "todo") {
      const text = getOptionValue<string>(interaction, "text") ?? "";
      const todo = await createTodo(text);
      return ephemeralMessage(`追加したよ\n#${todo.id} ${todo.text}`);
    }

    if (commandName === "todo-list") {
      const status = getOptionValue<string>(interaction, "status") ?? "open";
      const safeStatus = status === "done" || status === "all" ? status : "open";
      const todos = await listTodos(safeStatus, 20);
      const title = safeStatus === "open" ? "未完了タスク" : safeStatus === "done" ? "完了タスク" : "タスク一覧";
      return ephemeralMessage(formatTodoList(title, todos));
    }

    if (commandName === "todo-done") {
      const id = Number(getOptionValue<number>(interaction, "id"));
      if (!Number.isInteger(id) || id <= 0) {
        return ephemeralMessage("id は正の整数で入れてください。");
      }

      const result = await markTodoDone(id);
      if (!result.todo) {
        return ephemeralMessage(`Todo #${id} は見つからなかった。`);
      }

      if (result.alreadyDone) {
        return ephemeralMessage(`すでに完了済み\n#${result.todo.id} ${result.todo.text}`);
      }

      return ephemeralMessage(`完了にしたよ\n#${result.todo.id} ${result.todo.text}`);
    }

    if (commandName === "info") {
      const topic = getOptionValue<string>(interaction, "topic") ?? "";
      const info = resolveInfo(topic);
      if (!info) {
        return ephemeralMessage(`topic: ${topic} は未登録。`);
      }

      return ephemeralMessage(`${info.entry.title}\n${info.entry.url}`);
    }

    return ephemeralMessage(`未対応コマンド: ${commandName ?? "unknown"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return ephemeralMessage(`エラーが発生した\n${message}`);
  }
}
