package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestServerStyleErrors(t *testing.T) {
	for _, tc := range []struct {
		status, exit int
		code         string
	}{
		{401, exitAuth, "unauthorized"}, {403, exitForbidden, "forbidden"}, {404, exitNotFound, "not_found"}, {429, exitRateLimit, "rate_limited"}, {503, exitAPI, "service_unavailable"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				reply(w, map[string]any{"schema_version": 1, "error": "Device authorization required", "code": "Unrecognized server code"})
			}))
			defer s.Close()
			a, out, err := testApp(s.URL)
			n := a.run(context.Background(), []string{"--server", s.URL, "--json", "show", "entry"})
			var body map[string]any
			if n != tc.exit || out.Len() != 0 || json.Unmarshal(err.Bytes(), &body) != nil || body["code"] != tc.code {
				t.Fatal(n, out.String(), err.String())
			}
		})
	}
	for _, code := range []string{"authorization_pending", "slow_down", "access_denied", "expired_token", "invalid_grant"} {
		err := apiError(400, []byte(fmt.Sprintf(`{"error":%q}`, code)))
		if errorCode(err) != code {
			t.Fatal(code, err)
		}
	}
}
func TestRevokedLogoutRemovesCachedCredential(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		reply(w, map[string]any{"schema_version": 1, "error": "Device authorization required"})
	}))
	defer s.Close()
	a, out, err := testApp(s.URL)
	if n := a.run(context.Background(), []string{"--server", s.URL, "--json", "auth", "logout"}); n != 0 {
		t.Fatal(n, err.String())
	}
	if _, e := a.store.Get(s.URL); errorCode(e) != "not_logged_in" {
		t.Fatal("stale token retained")
	}
	if !strings.Contains(out.String(), `"authenticated":false`) {
		t.Fatal(out.String())
	}
}
func TestRepeatedLoginDoesNotOrphanAuthorization(t *testing.T) {
	for _, mode := range []string{"active", "forbidden", "unavailable", "revoked", "expired"} {
		t.Run(mode, func(t *testing.T) {
			grants := 0
			var s *httptest.Server
			s = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/read/v1/me":
					switch mode {
					case "active":
						reply(w, map[string]any{"schema_version": 1, "device": map[string]any{"id": "existing"}})
					case "forbidden":
						w.WriteHeader(403)
						reply(w, map[string]any{"schema_version": 1, "error": "Denied"})
					case "unavailable":
						w.WriteHeader(503)
						reply(w, map[string]any{"schema_version": 1, "error": "Try later"})
					case "revoked":
						w.WriteHeader(401)
						reply(w, map[string]any{"schema_version": 1, "error": "Device authorization required"})
					default:
						t.Error("expired token should not query me")
					}
				case "/oauth/device_authorization":
					grants++
					if r.Header.Get("Authorization") != "" {
						t.Error("old bearer sent to device auth")
					}
					reply(w, map[string]any{"device_code": "d", "user_code": "u", "verification_uri": s.URL + "/authorize", "expires_in": 600, "interval": 5})
				case "/oauth/token":
					reply(w, map[string]any{"access_token": "new-token", "token_type": "Bearer", "scope": "library:read", "expires_in": 2592000})
				default:
					t.Error(r.URL.Path)
				}
			}))
			defer s.Close()
			a, _, err := testApp(s.URL)
			a.sleep = func(context.Context, time.Duration) error { return nil }
			if mode == "expired" {
				old, _ := a.store.Get(s.URL)
				old.ExpiresAt = time.Now().Add(-time.Hour)
				_ = a.store.Set(s.URL, old)
			}
			n := a.run(context.Background(), []string{"--server", s.URL, "--json", "auth", "login", "--no-browser"})
			want := exitAuth
			switch mode {
			case "forbidden":
				want = exitForbidden
			case "unavailable":
				want = exitAPI
			case "revoked", "expired":
				want = 0
			}
			if n != want {
				t.Fatal(n, err.String())
			}
			cr, _ := a.store.Get(s.URL)
			if want == 0 {
				if grants != 1 || cr.Token != "new-token" {
					t.Fatal("relogin failed")
				}
			} else if grants != 0 || cr.Token != "fixture-token" {
				t.Fatal("existing authorization orphaned")
			}
		})
	}
}
func TestHumanCompletenessAndReadLocations(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/read/v1/content" {
			reply(w, map[string]any{"schema_version": 1, "file": "source/article.md", "content": "partial fragment", "start_line": 4, "end_line": 4, "total_lines": 10, "truncated": true, "next_line": 4, "next_column": 2048, "source_url": "https://source.example/article", "reader_url": "/?entry=entry"})
			return
		}
		reply(w, map[string]any{"schema_version": 1, "items": []any{}, "total": 0, "limit": 20, "offset": 0, "index": map[string]any{"complete": 2, "pending": 3, "failed": 1}})
	}))
	defer s.Close()
	for _, command := range []string{"list", "search"} {
		a, out, err := testApp(s.URL)
		args := []string{"--server", s.URL, command}
		if command == "search" {
			args = append(args, "query")
		}
		if n := a.run(context.Background(), args); n != 0 {
			t.Fatal(n, err.String())
		}
		for _, text := range []string{"complete=2 pending=3 failed=1", "INCOMPLETE INDEX"} {
			if !strings.Contains(out.String(), text) {
				t.Fatal(out.String())
			}
		}
	}
	a, out, err := testApp(s.URL)
	if n := a.run(context.Background(), []string{"--server", s.URL, "read", "entry"}); n != 0 {
		t.Fatal(n, err.String())
	}
	if out.String() != "partial fragment" {
		t.Fatal("stdout content changed")
	}
	for _, text := range []string{"source/article.md", "Lines: 4-4 / 10", "https://source.example/article", "/?entry=entry", "PARTIAL CONTENT", "--start-line 4 --start-column 2048"} {
		if !strings.Contains(err.String(), text) {
			t.Fatal(text, err.String())
		}
	}
}
func TestFailedKeyringSaveRevokesNewToken(t *testing.T) {
	revoked := false
	var s *httptest.Server
	s = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/device_authorization":
			reply(w, map[string]any{"device_code": "d", "user_code": "u", "verification_uri": s.URL + "/authorize", "expires_in": 600, "interval": 5})
		case "/oauth/token":
			reply(w, map[string]any{"access_token": "unsaved-token", "token_type": "Bearer", "expires_in": 3600, "scope": "library:read"})
		case "/api/read/v1/logout":
			revoked = r.Header.Get("Authorization") == "Bearer unsaved-token"
			reply(w, map[string]any{"schema_version": 1, "revoked": true})
		default:
			t.Error(r.URL.Path)
		}
	}))
	defer s.Close()
	a, out, err := testApp(s.URL)
	a.store = &memoryStore{data: map[string]credential{}, setError: fail(exitKeyring, "keyring_write_failed", "secure store unavailable")}
	a.sleep = func(context.Context, time.Duration) error { return nil }
	if n := a.run(context.Background(), []string{"--server", s.URL, "--json", "auth", "login", "--no-browser"}); n != exitKeyring || !revoked {
		t.Fatal(n, revoked, err.String())
	}
	if strings.Contains(out.String()+err.String(), "unsaved-token") {
		t.Fatal("token leaked")
	}
}
func TestCancellationAndBrowserFailure(t *testing.T) {
	var s *httptest.Server
	s = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]any{"device_code": "d", "user_code": "CODE", "verification_uri": s.URL + "/authorize", "expires_in": 600, "interval": 5})
	}))
	defer s.Close()
	a, out, err := testApp(s.URL)
	a.store = &memoryStore{data: map[string]credential{}}
	a.open = func(string) error { return errors.New("browser unavailable") }
	a.sleep = func(context.Context, time.Duration) error { return context.Canceled }
	if n := a.run(context.Background(), []string{"--server", s.URL, "--json", "auth", "login"}); n != exitAuth {
		t.Fatal(n)
	}
	if out.Len() != 0 || !strings.Contains(err.String(), "Browser could not be opened") || !strings.Contains(err.String(), "login_cancelled") {
		t.Fatal(out.String(), err.String())
	}
}
func TestHumanMetadataIsNotJSON(t *testing.T) {
	var out bytes.Buffer
	if e := human(&out, "show", map[string]any{"schema_version": 1, "title": "Test", "files": []any{map[string]any{"path": "a.md", "bytes": 12}}, "omitted": []any{"large.bin"}}); e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{"title: Test", "path: a.md", "large.bin"} {
		if !strings.Contains(out.String(), s) {
			t.Fatal(out.String())
		}
	}
}
