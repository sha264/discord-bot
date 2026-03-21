import { redis } from "@/lib/redis";

export type TodoStatus = "open" | "done";

export type Todo = {
  id: number;
  text: string;
  status: TodoStatus;
  createdAt: string;
  completedAt: string | null;
};

const TODO_OPEN_LIST_KEY = "todos:open";
const LEGACY_TODO_DONE_LIST_KEY = "todos:done";
const TODO_ID_MIN = 100;
const TODO_ID_MAX = 999;
const TODO_ID_SPACE_SIZE = TODO_ID_MAX - TODO_ID_MIN + 1;
const MAX_TODO_ID_ASSIGN_ATTEMPTS = TODO_ID_SPACE_SIZE * 2;

function todoKey(id: number): string {
  return `todo:${id}`;
}

function normalizeTodoText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function generateRandomTodoId(): number {
  return Math.floor(Math.random() * TODO_ID_SPACE_SIZE) + TODO_ID_MIN;
}

async function tryCreateTodoWithId(id: number, text: string, createdAt: string): Promise<Todo | null> {
  const todo: Todo = {
    id,
    text,
    status: "open",
    createdAt,
    completedAt: null
  };

  const inserted = await redis.set(todoKey(id), todo, { nx: true });
  if (inserted) {
    await redis.lpush(TODO_OPEN_LIST_KEY, id);
    return todo;
  }

  // 旧バージョンで残っている完了タスクはこのタイミングで回収する
  const existing = await getTodo(id);
  if (existing?.status !== "done") {
    return null;
  }

  await redis.del(todoKey(id));
  await redis.lrem(LEGACY_TODO_DONE_LIST_KEY, 0, id);

  const reclaimed = await redis.set(todoKey(id), todo, { nx: true });
  if (!reclaimed) {
    return null;
  }

  await redis.lpush(TODO_OPEN_LIST_KEY, id);
  return todo;
}

function castTodo(value: unknown): Todo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const todo = value as Partial<Todo>;
  if (typeof todo.id !== "number" || typeof todo.text !== "string" || typeof todo.status !== "string" || typeof todo.createdAt !== "string") {
    return null;
  }

  return {
    id: todo.id,
    text: todo.text,
    status: todo.status === "done" ? "done" : "open",
    createdAt: todo.createdAt,
    completedAt: todo.completedAt ?? null
  };
}

export async function createTodo(text: string): Promise<Todo> {
  const normalized = normalizeTodoText(text);
  if (!normalized) {
    throw new Error("Todo text must not be empty.");
  }

  const attemptedIds = new Set<number>();
  const createdAt = new Date().toISOString();

  for (let attempt = 0; attempt < MAX_TODO_ID_ASSIGN_ATTEMPTS && attemptedIds.size < TODO_ID_SPACE_SIZE; attempt += 1) {
    const id = generateRandomTodoId();
    if (attemptedIds.has(id)) {
      continue;
    }
    attemptedIds.add(id);

    const todo = await tryCreateTodoWithId(id, normalized, createdAt);
    if (todo) {
      return todo;
    }
  }

  for (let id = TODO_ID_MIN; id <= TODO_ID_MAX; id += 1) {
    if (attemptedIds.has(id)) {
      continue;
    }

    const todo = await tryCreateTodoWithId(id, normalized, createdAt);
    if (todo) {
      return todo;
    }
  }

  throw new Error("Todo ID の採番に失敗しました。空きIDを確保して再試行してください。");
}

export async function getTodo(id: number): Promise<Todo | null> {
  const todo = await redis.get(todoKey(id));
  return castTodo(todo);
}

async function getTodosFromIds(ids: Array<string | number>): Promise<Todo[]> {
  const todos = await Promise.all(
    ids.map(async (idValue) => {
      const numericId = typeof idValue === "number" ? idValue : Number(idValue);
      return getTodo(numericId);
    })
  );

  return todos.filter((todo): todo is Todo => Boolean(todo));
}

export async function listOpenTodos(limit = 20): Promise<Todo[]> {
  const ids = ((await redis.lrange(TODO_OPEN_LIST_KEY, 0, limit - 1)) ?? []) as Array<string | number>;
  return getTodosFromIds(ids);
}

export async function listDoneTodos(limit = 20): Promise<Todo[]> {
  void limit;
  return [];
}

export async function listTodos(status: "open" | "done" | "all", limit = 20): Promise<Todo[]> {
  if (status === "open") {
    return listOpenTodos(limit);
  }

  if (status === "done") {
    return [];
  }

  return listOpenTodos(limit);
}

export async function markTodoDone(id: number): Promise<{ todo: Todo | null; alreadyDone: boolean }> {
  const existing = await getTodo(id);
  if (!existing) {
    return { todo: null, alreadyDone: false };
  }

  const completed: Todo = {
    ...existing,
    status: "done",
    completedAt: existing.completedAt ?? new Date().toISOString()
  };

  await redis.lrem(TODO_OPEN_LIST_KEY, 0, id);
  await redis.lrem(LEGACY_TODO_DONE_LIST_KEY, 0, id);
  await redis.del(todoKey(id));

  return { todo: completed, alreadyDone: existing.status === "done" };
}

export function formatTodoList(title: string, todos: Todo[]): string {
  if (todos.length === 0) {
    return `${title}\n0件`;
  }

  const lines = todos.map((todo) => `#${todo.id} ${todo.text}`);
  return `${title} ${todos.length}件\n\n${lines.join("\n")}`;
}

export function formatDailyTodoMessage(todos: Todo[]): string {
  if (todos.length === 0) {
    return "今日のTodoは0件です。";
  }

  const body = todos.map((todo) => `#${todo.id} ${todo.text}`).join("\n");
  return [
    `今日のTodoは ${todos.length}件です。`,
    "",
    body,
    ""
  ].join("\n");
}
