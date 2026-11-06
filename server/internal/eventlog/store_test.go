package eventlog

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"quilldrop/server/internal/events"
)

func TestAppendAndReplayAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	payload := json.RawMessage(`{"taskId":"task-1","title":"test"}`)
	first, err := store.Append(events.Draft{Type: events.TaskCreated, Actor: "A", Payload: payload})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != 1 {
		t.Fatalf("want id 1, got %d", first.ID)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	items := reopened.After(0)
	if len(items) != 1 || items[0].ID != 1 {
		t.Fatalf("unexpected replay: %#v", items)
	}
	second, err := reopened.Append(events.Draft{Type: events.ChatMessage, Actor: "N", Payload: json.RawMessage(`{"text":"hi"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != 2 {
		t.Fatalf("want id 2, got %d", second.ID)
	}
}
