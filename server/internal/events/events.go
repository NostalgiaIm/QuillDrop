package events

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	TaskCreated     = "task.created"
	TaskClaimed     = "task.claimed"
	TaskDone        = "task.done"
	ChatMessage     = "chat.message"
	PresenceOnline  = "presence.online"
	PresenceOffline = "presence.offline"
)

var validTypes = map[string]bool{
	TaskCreated: true, TaskClaimed: true, TaskDone: true,
	ChatMessage: true, PresenceOnline: true, PresenceOffline: true,
}

type Event struct {
	ID      uint64          `json:"id"`
	Type    string          `json:"type"`
	Actor   string          `json:"actor"`
	Payload json.RawMessage `json:"payload"`
	At      time.Time       `json:"at"`
}

type Draft struct {
	Type    string          `json:"type"`
	Actor   string          `json:"actor"`
	Payload json.RawMessage `json:"payload"`
}

func (d Draft) Validate() error {
	if !validTypes[d.Type] {
		return errors.New("unsupported event type")
	}
	if strings.TrimSpace(d.Actor) == "" || len([]rune(d.Actor)) > 24 {
		return errors.New("actor must contain 1-24 characters")
	}
	if len(d.Payload) == 0 || !json.Valid(d.Payload) {
		return errors.New("payload must be valid JSON")
	}
	return nil
}
