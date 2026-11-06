import type { AppState, Message, StreamEvent, Task } from "./types";

export function createState(): AppState {
  return {
    tasks: new Map(),
    messages: [],
    online: new Map(),
    processedIds: new Set(),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function reduceEvent(state: AppState, event: StreamEvent): boolean {
  if (!Number.isSafeInteger(event.id) || state.processedIds.has(event.id)) return false;
  state.processedIds.add(event.id);
  const payload = event.payload ?? {};

  if (event.type === "task.created") {
    const taskId = text(payload.taskId);
    const title = text(payload.title).trim();
    if (!taskId || !title) return false;
    const assignee = text(payload.to) || null;
    const task: Task = {
      id: taskId,
      title,
      from: event.actor,
      to: assignee,
      status: "todo",
      note: text(payload.note),
      createdAt: event.at,
      updatedAt: event.at,
    };
    state.tasks.set(taskId, task);
    state.messages.push(systemMessage(event, assignee
      ? `${event.actor} 向 ${assignee} 派发了任务：${title}`
      : `${event.actor} 投放了新任务：${title}`));
  }

  if (event.type === "task.claimed") {
    const task = state.tasks.get(text(payload.taskId));
    if (!task) return false;
    task.to = text(payload.to) || event.actor;
    task.status = "doing";
    task.updatedAt = event.at;
    state.messages.push(systemMessage(event, `${task.to} 领取了任务：${task.title}`));
  }

  if (event.type === "task.done") {
    const task = state.tasks.get(text(payload.taskId));
    if (!task) return false;
    task.status = "done";
    task.updatedAt = event.at;
    state.messages.push(systemMessage(event, `${event.actor} 完成了任务：${task.title}`));
  }

  if (event.type === "chat.message") {
    const messageText = text(payload.text).trim();
    if (!messageText) return false;
    state.messages.push({
      id: text(payload.messageId) || `event-${event.id}`,
      eventId: event.id,
      from: event.actor,
      text: messageText,
      at: event.at,
      replyTo: text(payload.replyTo) || null,
    });
  }

  if (event.type === "presence.online") state.online.set(event.actor, event.at);
  if (event.type === "presence.offline") state.online.delete(event.actor);

  state.messages.sort((a, b) => a.eventId - b.eventId);
  return true;
}

function systemMessage(event: StreamEvent, message: string): Message {
  return {
    id: `system-${event.id}`,
    eventId: event.id,
    from: event.actor,
    text: message,
    at: event.at,
    replyTo: null,
    system: true,
  };
}
