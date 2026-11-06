package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"quilldrop/server/internal/eventlog"
	"quilldrop/server/internal/events"
)

type hub struct {
	mu      sync.RWMutex
	next    int
	clients map[int]chan events.Event
}

func newHub() *hub { return &hub{clients: make(map[int]chan events.Event)} }

func (h *hub) subscribe() (int, <-chan events.Event, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := h.next
	h.next++
	ch := make(chan events.Event, 64)
	h.clients[id] = ch
	return id, ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.clients, id)
	}
}

func (h *hub) publish(event events.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, ch := range h.clients {
		select {
		case ch <- event:
		default:
			// Force a slow client to reconnect. Its Last-Event-ID will replay
			// everything it did not receive from the durable log.
			close(ch)
			delete(h.clients, id)
		}
	}
}

type server struct {
	store *eventlog.Store
	hub   *hub
}

func main() {
	address := env("QUILLDROP_ADDR", "127.0.0.1:8787")
	dataDir := env("QUILLDROP_DATA_DIR", filepath.Join("server", "data"))
	store, err := eventlog.Open(filepath.Join(dataDir, "events.jsonl"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	app := &server{store: store, hub: newHub()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", app.health)
	mux.HandleFunc("GET /events", app.stream)
	mux.HandleFunc("POST /events", app.post)

	httpServer := &http.Server{Addr: address, Handler: app.withCORS(mux), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("QuillDrop event server listening on http://%s", address)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) post(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	var draft events.Draft
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&draft); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event JSON")
		return
	}
	if err := draft.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	event, err := s.store.Append(draft)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not persist event")
		return
	}
	s.hub.publish(event)
	writeJSON(w, http.StatusCreated, event)
}

func (s *server) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	after := parseAfter(r)
	_, live, unsubscribe := s.hub.subscribe()
	defer unsubscribe()
	lastSent := after
	for _, event := range s.store.After(after) {
		if err := sendEvent(w, event); err != nil {
			return
		}
		lastSent = event.ID
	}
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-live:
			if !ok {
				return
			}
			if event.ID <= lastSent {
				continue
			}
			if err := sendEvent(w, event); err != nil {
				return
			}
			lastSent = event.ID
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func sendEvent(w http.ResponseWriter, event events.Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", event.ID, event.Type, data)
	return err
}

func parseAfter(r *http.Request) uint64 {
	value := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if value == "" {
		value = r.URL.Query().Get("after")
	}
	id, _ := strconv.ParseUint(value, 10, 64)
	return id
}

func (s *server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
