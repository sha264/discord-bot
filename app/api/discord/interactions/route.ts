import { DISCORD_INTERACTION_RESPONSE_TYPE, DISCORD_MESSAGE_FLAGS, verifyDiscordRequest } from "@/lib/discord";
import { deleteInfo, listInfos, resolveInfo, upsertInfo, type InfoEntry } from "@/lib/infos";
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
    custom_id?: string;
  };
};

const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3
} as const;

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

function formatInfoListMessage(infos: InfoEntry[]): string {
  if (infos.length === 0) {
    return "info は0件です。/info で登録してください。";
  }

  const lines = infos.map((info) => `- ${info.title}\n  ${info.url}`);
  return `info 一覧 ${infos.length}件\n\n${lines.join("\n")}`;
}

async function buildTodoListResponse(): Promise<string> {
  const todos = await listTodos("open", 20);
  return formatTodoList("TODO", todos);
}

async function buildInfoListResponse(limit: number): Promise<string> {
  const infos = await listInfos(limit);
  return formatInfoListMessage(infos);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!verifyDiscordRequest(signature, timestamp, rawBody)) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  if (interaction.type === INTERACTION_TYPE.PING) {
    return jsonResponse({ type: DISCORD_INTERACTION_RESPONSE_TYPE.PONG });
  }

  try {
    if (interaction.type === INTERACTION_TYPE.MESSAGE_COMPONENT) {
      return ephemeralMessage("一覧の削除ボタンは廃止しました。/todo-delete または /info-delete を使ってください。");
    }

    if (interaction.type !== INTERACTION_TYPE.APPLICATION_COMMAND) {
      return ephemeralMessage("未対応の interaction type です。");
    }

    const commandName = interaction.data?.name;

    if (commandName === "todo") {
      const text = getOptionValue<string>(interaction, "text") ?? "";
      const todo = await createTodo(text);
      return ephemeralMessage(`以下のTODOを追加しました！\n#${todo.id} ${todo.text}`);
    }

    if (commandName === "todo-list") {
      const content = await buildTodoListResponse();
      return ephemeralMessage(content);
    }

    if (commandName === "todo-delete") {
      const id = Number(getOptionValue<number>(interaction, "id"));
      if (!Number.isInteger(id) || id <= 0) {
        return ephemeralMessage("id は正の整数で入れてください。");
      }

      const result = await markTodoDone(id);
      if (!result.todo) {
        return ephemeralMessage(`Todo #${id} が見つかりません`);
      }

      return ephemeralMessage(`削除しました！\n#${result.todo.id} ${result.todo.text}`);
    }

    if (commandName === "info") {
      const title = getOptionValue<string>(interaction, "title") ?? "";
      const url = getOptionValue<string>(interaction, "url");
      if (!title.trim()) {
        return ephemeralMessage("title を指定してください。");
      }

      const hasRegistrationInput = Boolean((url ?? "").trim());
      if (hasRegistrationInput) {
        const normalizedUrl = (url ?? "").trim();
        if (!normalizedUrl) {
          return ephemeralMessage("登録または更新時は url を指定してください。");
        }

        const result = await upsertInfo({
          title,
          url: normalizedUrl
        });

        const action = result.created ? "登録しました" : "更新しました";
        return ephemeralMessage(`${action}\n${result.entry.title}\n${result.entry.url}`);
      }

      const info = await resolveInfo(title);
      if (!info) {
        return ephemeralMessage(`title: ${title} は登録されていません`);
      }

      return ephemeralMessage(`${info.title}\n${info.url}`);
    }

    if (commandName === "info-list") {
      const limit = Number(getOptionValue<number>(interaction, "limit") ?? 20);
      if (!Number.isInteger(limit) || limit <= 0) {
        return ephemeralMessage("limit は正の整数で入れてください。");
      }

      const content = await buildInfoListResponse(limit);
      return ephemeralMessage(content);
    }

    if (commandName === "info-delete") {
      const title = getOptionValue<string>(interaction, "title") ?? "";
      if (!title.trim()) {
        return ephemeralMessage("title を指定してください。");
      }

      const deleted = await deleteInfo(title);
      if (!deleted) {
        return ephemeralMessage(`title: ${title} は登録されていません`);
      }

      return ephemeralMessage(`削除しました\n${deleted.title}\n${deleted.url}`);
    }

    return ephemeralMessage(`未対応コマンド: ${commandName ?? "unknown"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return ephemeralMessage(`エラーが発生しました\n${message}`);
  }
}
