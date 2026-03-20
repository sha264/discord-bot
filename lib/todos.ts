import { redis } from "@/lib/redis";
import { formatIsoForDisplay } from "@/lib/time";

export type TodoStatus = "open" | "done";

export type Todo = {
  id: number;
  text: string;
  status: TodoStatus;
  createdAt: string;
  completedAt: string | null;
};

const TODO_ID_KEY = "todo:next_id";
const TODO_OPEN_LIST_KEY = "todos:open";
const TODO_DONE_LIST_KEY = "todos:done";

function todoKey(id: number): string {
  return `todo:${id}`;
}

function normalizeTodoText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

  const id = await redis.incr(TODO_ID_KEY);
  const todo: Todo = {
    id,
    text: normalized,
    status: "open",
    createdAt: new Date().toISOString(),
    completedAt: null
  };

  await redis.set(todoKey(id), todo);
  await redis.lpush(TODO_OPEN_LIST_KEY, id);

  return todo;
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
  const ids = ((await redis.lrange(TODO_DONE_LIST_KEY, 0, limit - 1)) ?? []) as Array<string | number>;
  return getTodosFromIds(ids);
}

export async function listTodos(status: "open" | "done" | "all", limit = 20): Promise<Todo[]> {
  if (status === "open") {
    return listOpenTodos(limit);
  }

  if (status === "done") {
    return listDoneTodos(limit);
  }

  const [openTodos, doneTodos] = await Promise.all([listOpenTodos(limit), listDoneTodos(limit)]);
  return [...openTodos, ...doneTodos].slice(0, limit);
}

export async function markTodoDone(id: number): Promise<{ todo: Todo | null; alreadyDone: boolean }> {
  const existing = await getTodo(id);
  if (!existing) {
    return { todo: null, alreadyDone: false };
  }

  if (existing.status === "done") {
    return { todo: existing, alreadyDone: true };
  }

  const updated: Todo = {
    ...existing,
    status: "done",
    completedAt: new Date().toISOString()
  };

  await redis.set(todoKey(id), updated);
  await redis.lrem(TODO_OPEN_LIST_KEY, 1, id);
  await redis.lpush(TODO_DONE_LIST_KEY, id);

  return { todo: updated, alreadyDone: false };
}

export function formatTodoList(title: string, todos: Todo[]): string {
  if (todos.length === 0) {
    return `${title}\n0件`;
  }

  const lines = todos.map((todo) => {
    const tail = todo.status === "open" ? `作成 ${formatIsoForDisplay(todo.createdAt)}` : `完了 ${formatIsoForDisplay(todo.completedAt)}`;
    return `#${todo.id} ${todo.text}  ${tail}`;
  });

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
    "",
  ].join("\n");
}
