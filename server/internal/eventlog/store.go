package eventlog

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"quilldrop/server/internal/events"
)

// Store is a small durable append-only event log. Writes are synced before an
// event is returned to the broadcaster, so clients never observe uncommitted data.
type Store struct {
	mu     sync.RWMutex
	file   *os.File
	events []events.Event
	nextID uint64
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open event log: %w", err)
	}
	s := &Store{file: f, nextID: 1}
	if err := s.load(); err != nil {
		_ = f.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	if _, err := s.file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	scanner := bufio.NewScanner(s.file)
	buffer := make([]byte, 64*1024)
	scanner.Buffer(buffer, 2*1024*1024)
	line := 0
	for scanner.Scan() {
		line++
		var event events.Event
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return fmt.Errorf("decode event log line %d: %w", line, err)
		}
		if event.ID == 0 {
			return fmt.Errorf("event log line %d has invalid id", line)
		}
		s.events = append(s.events, event)
		if event.ID >= s.nextID {
			s.nextID = event.ID + 1
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scan event log: %w", err)
	}
	_, err := s.file.Seek(0, io.SeekEnd)
	return err
}

func (s *Store) Append(draft events.Draft) (events.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	event := events.Event{ID: s.nextID, Type: draft.Type, Actor: draft.Actor, Payload: draft.Payload, At: time.Now().UTC()}
	line, err := json.Marshal(event)
	if err != nil {
		return events.Event{}, err
	}
	line = append(line, '\n')
	if _, err := s.file.Write(line); err != nil {
		return events.Event{}, fmt.Errorf("append event: %w", err)
	}
	if err := s.file.Sync(); err != nil {
		return events.Event{}, fmt.Errorf("sync event: %w", err)
	}
	s.events = append(s.events, event)
	s.nextID++
	return event, nil
}

func (s *Store) After(id uint64) []events.Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]events.Event, 0)
	for _, event := range s.events {
		if event.ID > id {
			result = append(result, event)
		}
	}
	return result
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file == nil {
		return errors.New("store already closed")
	}
	err := s.file.Close()
	s.file = nil
	return err
}
