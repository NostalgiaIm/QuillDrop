import { EVENT_TYPES, type EventDraft, type EventType, type StreamEvent } from "./types";

export type ConnectionState = "connecting" | "online" | "offline";

export class EventClient {
  private source: EventSource | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly onEvent: (event: StreamEvent) => void,
    private readonly onConnection: (state: ConnectionState) => void,
  ) {}

  connect(): void {
    this.disconnect();
    this.onConnection("connecting");
    this.source = new EventSource(`${this.baseUrl}/events`);
    for (const type of EVENT_TYPES) {
      this.source.addEventListener(type, (raw) => {
        try {
          const event = JSON.parse((raw as MessageEvent).data) as StreamEvent;
          this.onEvent(event);
        } catch (error) {
          console.error("Ignored malformed stream event", error);
        }
      });
    }
    this.source.onopen = () => this.onConnection("online");
    this.source.onerror = () => this.onConnection("offline");
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
  }

  async post(draft: EventDraft, keepalive = false): Promise<StreamEvent> {
    const response = await fetch(`${this.baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
      keepalive,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.json() as Promise<StreamEvent>;
  }
}

export function draft(type: EventType, actor: string, payload: Record<string, unknown>): EventDraft {
  return { type, actor, payload };
}
