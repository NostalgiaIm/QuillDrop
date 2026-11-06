export const EVENT_TYPES = [
  "task.created",
  "task.claimed",
  "task.done",
  "chat.message",
  "presence.online",
  "presence.offline",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type TaskStatus = "todo" | "doing" | "done";

export interface StreamEvent<T = Record<string, unknown>> {
  id: number;
  type: EventType;
  actor: string;
  payload: T;
  at: string;
}

export interface EventDraft {
  type: EventType;
  actor: string;
  payload: Record<string, unknown>;
}

export interface Task {
  id: string;
  title: string;
  from: string;
  to: string | null;
  status: TaskStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  eventId: number;
  from: string;
  text: string;
  at: string;
  replyTo: string | null;
  system?: boolean;
}

export interface AppState {
  tasks: Map<string, Task>;
  messages: Message[];
  online: Map<string, string>;
  processedIds: Set<number>;
}
