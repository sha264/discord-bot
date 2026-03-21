import { DISCORD_INTERACTION_RESPONSE_TYPE, DISCORD_MESSAGE_FLAGS, verifyDiscordRequest } from "@/lib/discord";
import { createInfoDeleteToken, deleteInfoByToken, listInfos, resolveInfo, upsertInfo, type InfoEntry } from "@/lib/infos";
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
  return `todo_delete:${id}:${status}`;
}

function parseDoneButtonId(customId: string): { id: number; status: "open" | "done" | "all" } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || (parts[0] !== "todo_done" && parts[0] !== "todo_delete")) {
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

function makeInfoDeleteButtonId(token: string, limit: number): string {
  return `info_delete:${token}:${limit}`;
}

function parseInfoDeleteButtonId(customId: string): { token: string; limit: number } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== "info_delete") {
    return null;
  }

  const limit = Number(parts[2]);
  if (!Number.isInteger(limit) || limit <= 0) {
    return null;
  }

  const token = parts[1]?.trim();
  if (!token) {
    return null;
  }

  return { token, limit };
}

function formatInfoListView(infos: InfoEntry[]): { content: string; visibleInfos: InfoEntry[] } {
  if (infos.length === 0) {
    return {
      content: "info は0件です。/info で登録してください。",
      visibleInfos: []
    };
  }

  const header = `info 一覧 ${infos.length}件`;
  const lines = infos.map((info) => formatInfoEntry(info));
  const full = `${header}\n\n${lines.join("\n")}`;
  if (full.length <= MAX_INFO_LIST_MESSAGE_LENGTH) {
    return { content: full, visibleInfos: infos };
  }

  const kept: string[] = [];
  const visibleInfos: InfoEntry[] = [];
  let used = `${header}\n\n`.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const nextLength = used + line.length + 1;
    if (nextLength > MAX_INFO_LIST_MESSAGE_LENGTH - 24) {
      break;
    }
    kept.push(line);
    visibleInfos.push(infos[i]);
    used = nextLength;
  }

  const omittedCount = lines.length - kept.length;
  return {
    content: `${header}\n\n${kept.join("\n")}\n...他 ${omittedCount}件`,
    visibleInfos
  };
}

async function buildInfoButtons(infos: InfoEntry[], limit: number) {
  const targets = infos.slice(0, 20);
  if (targets.length === 0) {
    return [];
  }

  const rows = [];
  for (let i = 0; i < targets.length; i += 5) {
    const chunk = targets.slice(i, i + 5);
    const tokens = await Promise.all(chunk.map((info) => createInfoDeleteToken(info.title)));
    rows.push({
      type: COMPONENT_TYPE.ACTION_ROW,
      components: chunk.map((info, index) => ({
        type: COMPONENT_TYPE.BUTTON,
        style: 4,
        custom_id: makeInfoDeleteButtonId(tokens[index], limit),
        label: `削除 ${shorten(info.title, 20)}`
      }))
    });
  }

  return rows;
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
        label: `削除 #${todo.id} ${shorten(todo.text)}`
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

async function buildInfoListResponse(limit: number) {
  const infos = await listInfos(limit);
  const view = formatInfoListView(infos);
  return {
    content: view.content,
    components: await buildInfoButtons(view.visibleInfos, limit)
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
        const infoParsed = parseInfoDeleteButtonId(customId);
        if (!infoParsed) {
          return updateMessage("不正なボタン操作です。", []);
        }

        const deleted = await deleteInfoByToken(infoParsed.token);
        const nextView = await buildInfoListResponse(infoParsed.limit);
        if (!deleted) {
          return updateMessage(`削除対象が見つかりません\n\n${nextView.content}`, nextView.components);
        }

        return updateMessage(`削除しました\n${deleted.title}\n${deleted.url}\n\n${nextView.content}`, nextView.components);
      }

      const result = await markTodoDone(parsed.id);
      const nextView = await buildTodoListResponse(parsed.status);

      if (!result.todo) {
        return updateMessage(`Todo #${parsed.id} が見つかりません\n\n${nextView.content}`, nextView.components);
      }

      if (result.alreadyDone) {
        return updateMessage(`すでに削除済みです\n#${result.todo.id} ${result.todo.text}\n\n${nextView.content}`, nextView.components);
      }

      return updateMessage(`削除しました！\n#${result.todo.id} ${result.todo.text}\n\n${nextView.content}`, nextView.components);
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

      const view = await buildInfoListResponse(limit);
      return ephemeralMessageWithComponents(view.content, view.components);
    }

    return ephemeralMessage(`未対応コマンド: ${commandName ?? "unknown"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return ephemeralMessage(`エラーが発生しました\n${message}`);
  }
}
