import "./style.css";
import { EventClient, draft, type ConnectionState } from "./api";
import { createState, reduceEvent } from "./store";
import type { Message, Task, TaskStatus } from "./types";

const API_URL = (import.meta.env.VITE_EVENT_API || "http://127.0.0.1:8787").replace(/\/$/, "");
const ME = (import.meta.env.VITE_QUILLDROP_USER || localStorage.getItem("quilldrop_user") || "A").trim();
const DEFAULT_PEOPLE = ["A", "N", "C", "L", "K", "B"];
const COLORS = ["#ffcf5c", "#5b8cff", "#f472b6", "#4ade80", "#a78bfa", "#38bdf8", "#fb7185"];
const state = createState();

type Tab = "tasks" | "board" | "chat";
let currentTab: Tab = "tasks";
let connection: ConnectionState = "connecting";
let replyTarget: Message | null = null;
let collapsed = false;
let pinned = localStorage.getItem("quilldrop_pinned") !== "false";
let taskUnread = 0;
let chatUnread = 0;
let toastTimer = 0;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

app.innerHTML = `
  <main class="shell" id="shell">
    ${["n", "s", "w", "e", "nw", "ne", "sw", "se"].map((edge) => `<i class="resize resize-${edge}" data-resize="${edge}"></i>`).join("")}
    <header class="titlebar" data-tauri-drag-region>
      <span class="logo" aria-hidden="true"><span></span></span>
      <div class="brand" data-tauri-drag-region>
        <strong>QuillDrop</strong>
        <small>轻轻投下，稳稳接住</small>
      </div>
      <div class="status" id="status"><span></span><b>连接中</b></div>
      <button class="icon-button" id="pin" title="置顶" aria-label="切换置顶">${icon("pin")}</button>
      <button class="icon-button" id="reset" title="恢复默认尺寸" aria-label="恢复默认尺寸">${icon("reset")}</button>
      <button class="icon-button" id="collapse" title="收起" aria-label="收起面板">${icon("minus")}</button>
    </header>
    <section class="workspace">
      <nav class="tabs" aria-label="主视图">
        <button class="tab active" data-tab="tasks">任务 <span class="badge" id="task-badge" hidden>0</span></button>
        <button class="tab" data-tab="board">在线状态</button>
        <button class="tab" data-tab="chat">交流站 <span class="badge" id="chat-badge" hidden>0</span></button>
      </nav>
      <section class="content" id="content"></section>
      <footer class="composer" id="composer"></footer>
    </section>
    <div class="toast" id="toast" role="status"></div>
  </main>`;

const shell = byId("shell");
const content = byId("content");
const composer = byId("composer");

const client = new EventClient(API_URL, (event) => {
  if (!reduceEvent(state, event)) return;
  if (event.actor !== ME) {
    if (event.type.startsWith("task.") && currentTab !== "tasks") taskUnread++;
    if (event.type === "chat.message" && currentTab !== "chat") chatUnread++;
  }
  render();
}, (next) => {
  const wasOnline = connection === "online";
  connection = next;
  renderStatus();
  if (next === "online" && !wasOnline) void post("presence.online", {});
});

client.connect();
render();
void applyPinned(pinned);

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab as Tab));
});
byId("pin").addEventListener("click", () => void applyPinned(!pinned));
byId("reset").addEventListener("click", () => void resetWindow());
byId("collapse").addEventListener("click", () => toggleCollapse());
document.querySelectorAll<HTMLElement>("[data-resize]").forEach((handle) => {
  handle.addEventListener("pointerdown", () => void startResize(handle.dataset.resize || "se"));
});

content.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const action = target.closest<HTMLButtonElement>("[data-action]");
  if (!action) return;
  const task = state.tasks.get(action.dataset.task || "");
  if (!task) return;
  if (action.dataset.action === "claim") void post("task.claimed", { taskId: task.id, to: ME });
  if (action.dataset.action === "done") void post("task.done", { taskId: task.id });
  if (action.dataset.action === "quote") {
    replyTarget = state.messages.find((message) => message.id === action.dataset.message) || null;
    renderComposer();
    document.querySelector<HTMLInputElement>("#chat-input")?.focus();
  }
});

composer.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("#send-task")) void createTask();
  if (target.closest("#send-chat")) void sendChat();
  if (target.closest("#cancel-reply")) { replyTarget = null; renderComposer(); }
});
composer.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  if (currentTab === "tasks") void createTask();
  if (currentTab === "chat") void sendChat();
});

window.addEventListener("beforeunload", () => {
  void client.post(draft("presence.offline", ME, {}), true).catch(() => undefined);
});

function render(): void {
  renderStatus();
  renderBadges();
  if (currentTab === "tasks") renderTasks();
  if (currentTab === "board") renderBoard();
  if (currentTab === "chat") renderChat();
  renderComposer();
}

function renderStatus(): void {
  const node = byId("status");
  node.className = `status ${connection}`;
  node.querySelector("b")!.textContent = connection === "online" ? `${state.online.size || 1} 人在线` : connection === "offline" ? "正在重连" : "连接中";
}

function renderTasks(): void {
  const groups: Array<{ status: TaskStatus; label: string }> = [
    { status: "todo", label: "待领取" }, { status: "doing", label: "进行中" }, { status: "done", label: "已完成" },
  ];
  const tasks = [...state.tasks.values()];
  if (!tasks.length) {
    content.innerHTML = emptyState("inbox", "还没有任务", "从下方投放第一枚任务，它会同步到所有在线成员。", "事件流就绪");
    return;
  }
  content.innerHTML = `<div class="task-list">${groups.map((group) => {
    const items = tasks.filter((task) => task.status === group.status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!items.length) return "";
    return `<section class="task-group"><h2>${group.label}<span>${items.length}</span></h2>${items.map(taskCard).join("")}</section>`;
  }).join("")}</div>`;
}

function taskCard(task: Task): string {
  let action = "";
  if (task.status === "todo" && (!task.to || task.to === ME)) action = `<button class="pill" data-action="claim" data-task="${attr(task.id)}">${task.to === ME ? "接下任务" : "我来做"}</button>`;
  if (task.status === "todo" && task.to && task.to !== ME) action = `<span class="processing">等待 ${escapeHtml(task.to)} 接单</span>`;
  if (task.status === "doing" && task.to === ME) action = `<button class="pill success" data-action="done" data-task="${attr(task.id)}">标记完成</button>`;
  if (task.status === "doing" && task.to !== ME) action = `<span class="processing">${escapeHtml(task.to || "成员")} 处理中</span>`;
  return `<article class="task-card ${task.status}">
    <div class="task-main"><h3>${mentions(task.title)}</h3>${task.note ? `<p>${escapeHtml(task.note)}</p>` : ""}
      <div class="meta"><span>来自 ${escapeHtml(task.from)}</span>${task.to ? `<span>交给 ${escapeHtml(task.to)}</span>` : `<span>开放领取</span>`}<time>${formatTime(task.updatedAt)}</time></div>
      ${action ? `<div class="actions">${action}</div>` : ""}
    </div><span class="state-mark">${task.status === "done" ? icon("check") : icon("quill")}</span>
  </article>`;
}

function renderBoard(): void {
  const people = allPeople();
  content.innerHTML = `<div class="board-head"><div><span class="eyebrow">TEAM PULSE</span><h2>此刻，大家在做什么</h2></div><span class="live-label"><i></i>实时</span></div>
    <div class="board-list">${people.map((person, index) => {
      const assigned = [...state.tasks.values()].filter((task) => task.to === person);
      const doing = assigned.find((task) => task.status === "doing");
      const done = assigned.filter((task) => task.status === "done").length;
      const pending = assigned.filter((task) => task.status === "todo").length;
      const online = state.online.has(person) || person === ME;
      const detail = doing ? `<span class="verb">正在处理</span><strong>${escapeHtml(doing.title)}</strong>` : pending ? `<span class="verb">${pending} 个任务待接单</span>` : assigned.length && done === assigned.length ? `<span class="verb completed">已清空任务</span>` : `<span class="verb quiet">暂无进行中任务</span>`;
      return `<article class="person ${online ? "is-online" : ""}"><span class="avatar" style="--avatar:${colorFor(person, index)}">${escapeHtml(initial(person))}</span><div><h3>${escapeHtml(person)}${person === ME ? `<em>我</em>` : ""}</h3><p>${detail}</p></div><span class="presence">${online ? "在线" : "离线"}</span></article>`;
    }).join("")}</div>`;
}

function renderChat(): void {
  if (!state.messages.length) {
    content.innerHTML = emptyState("chat", "交流站还很安静", "说句话，或在任务流转时让系统自动留下记录。", "围绕任务，短聊一下");
    return;
  }
  content.innerHTML = `<div class="chat-list">${state.messages.map((message) => {
    if (message.system) return `<div class="system-message"><span>${icon("spark")}</span>${escapeHtml(message.text)}<time>${formatTime(message.at)}</time></div>`;
    const mine = message.from === ME;
    const quote = message.replyTo ? state.messages.find((candidate) => candidate.id === message.replyTo) : null;
    return `<article class="message ${mine ? "mine" : ""}"><span class="avatar" style="--avatar:${colorFor(message.from)}">${escapeHtml(initial(message.from))}</span><div class="bubble">${quote ? `<blockquote>${escapeHtml(quote.from)} · ${escapeHtml(quote.text)}</blockquote>` : ""}<p>${mentions(message.text)}</p><footer><time>${formatTime(message.at)}</time><button data-action="quote" data-message="${attr(message.id)}">引用</button></footer></div></article>`;
  }).join("")}</div>`;
  requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
}

function renderComposer(): void {
  composer.hidden = currentTab === "board";
  if (currentTab === "tasks") {
    composer.innerHTML = `<div class="input-row"><label class="input-shell">${icon("plus")}<input id="task-input" maxlength="180" placeholder="投放新任务… 输入 @某人 可指派" autocomplete="off" /></label><button class="send" id="send-task">投放</button></div>`;
  }
  if (currentTab === "chat") {
    composer.innerHTML = `${replyTarget ? `<div class="reply-bar"><span>回复 <b>${escapeHtml(replyTarget.from)}</b> · ${escapeHtml(replyTarget.text)}</span><button id="cancel-reply">×</button></div>` : ""}<div class="input-row"><label class="input-shell">${icon("message")}<input id="chat-input" maxlength="500" placeholder="发送消息… 支持 @某人" autocomplete="off" /></label><button class="send" id="send-chat">发送</button></div>`;
  }
}

async function createTask(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#task-input");
  const title = input?.value.trim() || "";
  if (!title) return;
  const assignee = parseAssignee(title);
  if (input) input.value = "";
  await post("task.created", { taskId: crypto.randomUUID(), title, to: assignee, note: "" });
}

async function sendChat(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#chat-input");
  const message = input?.value.trim() || "";
  if (!message) return;
  const replyTo = replyTarget?.id || null;
  if (input) input.value = "";
  replyTarget = null;
  await post("chat.message", { messageId: crypto.randomUUID(), text: message, replyTo });
}

async function post(type: Parameters<typeof draft>[0], payload: Record<string, unknown>): Promise<void> {
  try {
    const event = await client.post(draft(type, ME, payload));
    if (reduceEvent(state, event)) render();
  } catch (error) {
    showToast(error instanceof Error ? `发送失败：${error.message}` : "发送失败，请检查服务");
  }
}

function switchTab(tab: Tab): void {
  currentTab = tab;
  if (tab === "tasks") taskUnread = 0;
  if (tab === "chat") chatUnread = 0;
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((node) => node.classList.toggle("active", node.dataset.tab === tab));
  render();
  if (tab === "tasks") document.querySelector<HTMLInputElement>("#task-input")?.focus();
  if (tab === "chat") document.querySelector<HTMLInputElement>("#chat-input")?.focus();
}

function renderBadges(): void {
  updateBadge("task-badge", taskUnread, currentTab !== "tasks");
  updateBadge("chat-badge", chatUnread, currentTab !== "chat");
}

function updateBadge(id: string, count: number, show: boolean): void {
  const badge = byId(id);
  badge.hidden = !show || count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}

async function applyPinned(next: boolean): Promise<void> {
  pinned = next;
  localStorage.setItem("quilldrop_pinned", String(pinned));
  byId("pin").classList.toggle("active", pinned);
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(pinned);
  }
}

function toggleCollapse(): void {
  collapsed = !collapsed;
  shell.classList.toggle("collapsed", collapsed);
  byId("collapse").innerHTML = collapsed ? icon("plus") : icon("minus");
}

async function resetWindow(): Promise<void> {
  if (!isTauri()) { showToast("桌面版中会恢复窗口默认尺寸"); return; }
  const { getCurrentWindow, currentMonitor, LogicalPosition, LogicalSize } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  await window.setSize(new LogicalSize(380, 540));
  const monitor = await currentMonitor();
  if (monitor) {
    const scale = monitor.scaleFactor;
    const width = monitor.size.width / scale;
    await window.setPosition(new LogicalPosition(Math.max(16, width - 404), 24));
  }
}

async function startResize(edge: string): Promise<void> {
  if (!isTauri() || collapsed) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  type Direction = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];
  const map: Record<string, Direction> = {
    n: "North", s: "South", w: "West", e: "East",
    nw: "NorthWest", ne: "NorthEast", sw: "SouthWest", se: "SouthEast",
  };
  await getCurrentWindow().startResizeDragging(map[edge] ?? "SouthEast");
}

function allPeople(): string[] {
  const names = new Set(DEFAULT_PEOPLE);
  names.add(ME);
  state.online.forEach((_, name) => names.add(name));
  state.tasks.forEach((task) => { names.add(task.from); if (task.to) names.add(task.to); });
  return [...names];
}

function parseAssignee(value: string): string | null {
  const match = value.match(/@(?:to)?([\p{L}\p{N}_-]+)/u);
  return match?.[1] || null;
}

function mentions(value: string): string {
  return escapeHtml(value).replace(/@(?:to)?([\p{L}\p{N}_-]+)/gu, '<mark>@$1</mark>');
}

function emptyState(kind: "inbox" | "chat", title: string, message: string, kicker: string): string {
  return `<div class="empty"><span class="empty-icon">${icon(kind)}</span><span class="eyebrow">${escapeHtml(kicker)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function colorFor(name: string, fallback = 0): string {
  let hash = fallback;
  for (const char of name) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}
function initial(name: string): string { return [...name][0]?.toUpperCase() || "?"; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function attr(value: string): string { return escapeHtml(value); }
function isTauri(): boolean { return "__TAURI_INTERNALS__" in window; }
function byId(id: string): HTMLElement { const node = document.getElementById(id); if (!node) throw new Error(`Missing #${id}`); return node; }
function showToast(message: string): void { const toast = byId("toast"); toast.textContent = message; toast.classList.add("show"); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000); }

function icon(name: string): string {
  const paths: Record<string, string> = {
    pin: '<path d="m14 4 6 6-3 1-4 4-1 5-2-2-6 6-1-1 6-6-2-2 5-1 4-4 1-3Z"/>',
    reset: '<path d="M4 7h5V2M4 7a9 9 0 1 1-1 8"/>',
    minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>', quill: '<path d="M20 4c-6-1-12 2-14 8-1 3 0 6 0 6s3 1 6 0c6-2 9-8 8-14ZM6 18l8-8"/>',
    spark: '<path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8L12 3Z"/>',
    inbox: '<path d="M4 5h16v13H4zM4 13h5l2 2h2l2-2h5"/>',
    chat: '<path d="M4 5h16v12H8l-4 3V5Z"/>', message: '<path d="M4 5h16v12H8l-4 3V5Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}
