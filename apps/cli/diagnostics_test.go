package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDiagnosticCommandsUseIndependentCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer diagnostic-token" {
			t.Error("wrong scope credential")
		}
		if r.URL.Path != "/api/read/v1/tasks/task-1/diagnostics" {
			t.Error(r.URL.Path)
		}
		reply(w, map[string]any{"schema_version": 1, "task": map[string]any{"id": "task-1"}, "complete": true})
	}))
	defer server.Close()
	a, out, stderr := testApp(server.URL)
	a.store = &memoryStore{data: map[string]credential{
		server.URL:                       {Token: "library-token", Origin: server.URL, ExpiresAt: time.Now().Add(time.Hour)},
		server.URL + "#diagnostics:read": {Token: "diagnostic-token", Scope: "diagnostics:read", Origin: server.URL, ExpiresAt: time.Now().Add(time.Hour)},
	}}
	if n := a.run(context.Background(), []string{"--server", server.URL, "tasks", "diagnose", "task-1", "--json"}); n != 0 {
		t.Fatalf("exit %d: %s", n, stderr)
	}
	if !strings.Contains(out.String(), "task-1") {
		t.Fatal(out.String())
	}
	if c, e := a.store.Get(server.URL); e != nil || c.Token != "library-token" {
		t.Fatal("library grant changed")
	}
}
func TestDiagnosticsDoNotFallbackToLibraryGrant(t *testing.T) {
	a, _, stderr := testApp("http://127.0.0.1:4317")
	a.store = &memoryStore{data: map[string]credential{"http://127.0.0.1:4317": {Token: "library-token", Origin: "http://127.0.0.1:4317", ExpiresAt: time.Now().Add(time.Hour)}}}
	if n := a.run(context.Background(), []string{"tasks", "show", "task-1", "--json"}); n != exitAuth {
		t.Fatalf("exit %d: %s", n, stderr)
	}
}
func TestDiagnosticCLIValidatesReadCommands(t *testing.T) {
	for _, args := range [][]string{{"tasks", "evidence", "task-1", "--id", "event-1"}, {"tasks", "events", "task-1", "--attempt", "attempt-1", "--limit", "10", "--cursor", "0"}, {"auth", "status", "--scope", "diagnostics:read"}} {
		if _, e := parse(args); e != nil {
			t.Fatal(args, e)
		}
	}
	for _, args := range [][]string{{"tasks", "evidence", "task-1"}, {"auth", "login", "--scope", "admin"}, {"tasks", "retry", "task-1"}} {
		if _, e := parse(args); e == nil {
			t.Fatal("accepted", args)
		}
	}
}
