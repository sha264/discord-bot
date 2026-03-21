import { DISCORD_INTERACTION_RESPONSE_TYPE, DISCORD_MESSAGE_FLAGS, verifyDiscordRequest } from "@/lib/discord";
import { deleteInfo, listInfos, resolveInfo, upsertInfo, type InfoEntry } from "@/lib/infos";
import { createTodo, formatTodoList, listTodos, markTodoDone, type Todo } from "@/lib/todos";

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

const COMPONENT_TYPE = {
  ACTION_ROW: 1,
  BUTTON: 2
} as const;

const MAX_INFO_LIST_MESSAGE_LENGTH = 1900;

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

function ephemeralMessageWithComponents(content: string, components: unknown[]): Response {
  return jsonResponse({
    type: DISCORD_INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      components,
      flags: DISCORD_MESSAGE_FLAGS.EPHEMERAL
    }
  });
}

function updateMessage(content: string, components: unknown[]): Response {
  return jsonResponse({
    type: 7,
    data: {
      content,
      components
    }
  });
}

function normalizeStatus(status: string | undefined): "open" | "done" | "all" {
  if (status === "done" || status === "all") {
    return status;
  }
  return "open";
}

function getTitle(status: "open" | "done" | "all"): string {
  if (status === "done") {
    return "完了タスク";
  }
  if (status === "all") {
    return "タスク一覧";
  }
  return "TODO";
}

function makeDoneButtonId(id: number, status: "open" | "done" | "all"): string {
  return `todo_done:${id}:${status}`;
}

function parseDoneButtonId(customId: string): { id: number; status: "open" | "done" | "all" } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== "todo_done") {
    return null;
  }

  const id = Number(parts[1]);
  const status = normalizeStatus(parts[2]);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return { id, status };
}

function shorten(text: string, maxLength = 18): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatInfoEntry(entry: InfoEntry): string {
  return `- ${entry.title}\n  ${entry.url}`;
}

function formatInfoListMessage(infos: InfoEntry[]): string {
  if (infos.length === 0) {
    return "info は0件です。/info で登録してください。";
  }

  const header = `info 一覧 ${infos.length}件`;
  const lines = infos.map((info) => formatInfoEntry(info));
  const full = `${header}\n\n${lines.join("\n")}`;
  if (full.length <= MAX_INFO_LIST_MESSAGE_LENGTH) {
    return full;
  }

  const kept: string[] = [];
  let used = `${header}\n\n`.length;
  for (const line of lines) {
    const nextLength = used + line.length + 1;
    if (nextLength > MAX_INFO_LIST_MESSAGE_LENGTH - 24) {
      break;
    }
    kept.push(line);
    used = nextLength;
  }

  const omittedCount = lines.length - kept.length;
  return `${header}\n\n${kept.join("\n")}\n...他 ${omittedCount}件`;
}

function buildTodoButtons(todos: Todo[], status: "open" | "done" | "all") {
  const openTodos = todos.filter((todo) => todo.status === "open").slice(0, 20);

  if (openTodos.length === 0) {
    return [];
  }

  const rows = [];

  for (let i = 0; i < openTodos.length; i += 5) {
    const chunk = openTodos.slice(i, i + 5);
    rows.push({
      type: COMPONENT_TYPE.ACTION_ROW,
      components: chunk.map((todo) => ({
        type: COMPONENT_TYPE.BUTTON,
        style: 3,
        custom_id: makeDoneButtonId(todo.id, status),
        label: `完了 #${todo.id} ${shorten(todo.text)}`
      }))
    });
  }

  return rows;
}

async function buildTodoListResponse(status: "open" | "done" | "all") {
  const todos = await listTodos(status, 20);
  const title = getTitle(status);

  return {
    content: formatTodoList(title, todos),
    components: buildTodoButtons(todos, status)
  };
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
      const customId = interaction.data?.custom_id ?? "";
      const parsed = parseDoneButtonId(customId);

      if (!parsed) {
        return updateMessage("不正なボタン操作です。", []);
      }

      const result = await markTodoDone(parsed.id);
      const nextView = await buildTodoListResponse(parsed.status);

      if (!result.todo) {
        return updateMessage(`Todo #${parsed.id} が見つかりません\n\n${nextView.content}`, nextView.components);
      }

      if (result.alreadyDone) {
        return updateMessage(`すでに完了済みです\n#${result.todo.id} ${result.todo.text}\n\n${nextView.content}`, nextView.components);
      }

      return updateMessage(`完了にしました！\n#${result.todo.id} ${result.todo.text}\n\n${nextView.content}`, nextView.components);
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
      const status = normalizeStatus(getOptionValue<string>(interaction, "status"));
      const view = await buildTodoListResponse(status);
      return ephemeralMessageWithComponents(view.content, view.components);
    }

    if (commandName === "todo-done") {
      const id = Number(getOptionValue<number>(interaction, "id"));
      if (!Number.isInteger(id) || id <= 0) {
        return ephemeralMessage("id は正の整数で入れてください。");
      }

      const result = await markTodoDone(id);
      if (!result.todo) {
        return ephemeralMessage(`Todo #${id} が見つかりません`);
      }

      if (result.alreadyDone) {
        return ephemeralMessage(`すでに完了済みです\n#${result.todo.id} ${result.todo.text}`);
      }

      return ephemeralMessage(`完了にしました！\n#${result.todo.id} ${result.todo.text}`);
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

      const infos = await listInfos(limit);
      return ephemeralMessage(formatInfoListMessage(infos));
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
