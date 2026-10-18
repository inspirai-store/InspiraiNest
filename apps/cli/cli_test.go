package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

type memoryStore struct {
	data     map[string]credential
	setError error
}

func (s *memoryStore) Get(k string) (credential, error) {
	v, ok := s.data[k]
	if !ok {
		return credential{}, fail(exitAuth, "not_logged_in", "not logged in")
	}
	return v, nil
}
func (s *memoryStore) Set(k string, v credential) error {
	if s.setError != nil {
		return s.setError
	}
	s.data[k] = v
	return nil
}
func (s *memoryStore) Delete(k string) error { delete(s.data, k); return nil }
func testApp(server string) (*app, *bytes.Buffer, *bytes.Buffer) {
	out, err := new(bytes.Buffer), new(bytes.Buffer)
	a := newApp(out, err)
	a.store = &memoryStore{data: map[string]credential{server: {Token: "fixture-token", Origin: server, ExpiresAt: time.Now().Add(time.Hour)}}}
	a.open = func(string) error { return nil }
	return a, out, err
}
func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func TestOrigins(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{"https://EXAMPLE.com:443/", "https://example.com"}, {"http://localhost:80", "http://localhost"}, {"http://127.0.0.1:8080", "http://127.0.0.1:8080"}, {"http://[::1]:99", "http://[::1]:99"}, {"https://[2001:db8::1]:443/", "https://[2001:db8::1]"},
	} {
		got, e := origin(tc.raw)
		if e != nil || got != tc.want {
			t.Errorf("origin(%q)=%q %v", tc.raw, got, e)
		}
	}
	for _, s := range []string{"http://example.com", "ftp://localhost", "https://u:p@example.com", "https://example.com/api", "https://example.com?x=y", "https://example.com#x", "https://example.com?", "http://127.0.0.1.evil.test", "https://example.com:0", "https://example.com:99999", "//example.com"} {
		if _, e := origin(s); e == nil {
			t.Errorf("accepted %q", s)
		}
	}
}
func TestFlags(t *testing.T) {
	for _, args := range [][]string{{"list", "--limit", "101"}, {"read", "x", "--max-lines", "1001"}, {"read", "x", "--start-line", "0"}, {"read", "x", "--start-column", "-1"}, {"list", "--offset", "-1"}, {"list", "--from", "2026-02-30"}, {"list", "--from", "2026-09-01", "--to", "2026-08-01"}, {"download", "x", "--file", "a"}, {"list", "--file", "a"}, {"list", "--json", "--json"}, {"auth", "foo"}} {
		if _, e := parse(args); e == nil {
			t.Errorf("accepted %v", args)
		}
	}
	o, e := parse([]string{"read", "entry", "--json", "--start-column", "3"})
	if e != nil || !o.json || o.query.Get("start_line") != "1" || o.query.Get("max_lines") != "200" || o.query.Get("start_column") != "3" {
		t.Fatalf("%+v %v", o, e)
	}
	o, e = parse([]string{"search", "--json", "--", "--literal"})
	if e != nil || o.args[0] != "--literal" {
		t.Fatal(o, e)
	}
}
func TestReadAndSearchContract(t *testing.T) {
	for _, command := range []string{"read", "search", "list", "show", "auth status"} {
		t.Run(command, func(t *testing.T) {
			var got url.Values
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer fixture-token" {
					t.Error("missing bearer or incorrect method")
				}
				got = r.URL.Query()
				switch command {
				case "read":
					if r.URL.Path != "/api/read/v1/content" {
						t.Error(r.URL.Path)
					}
					reply(w, map[string]any{"schema_version": 1, "id": "entry 1", "archive_id": "a", "content": "😀fragment", "next_line": 2, "next_column": 3, "truncated": true})
				case "list", "search":
					reply(w, map[string]any{"schema_version": 1, "items": []any{}, "total": 0, "limit": 100, "offset": 2, "index": map[string]any{"complete": 1, "pending": 2, "failed": 3}})
				default:
					reply(w, map[string]any{"schema_version": 1, "id": "entry 1", "archive_id": "a", "omitted": []string{"large.bin"}})
				}
			}))
			defer s.Close()
			a, out, err := testApp(s.URL)
			args := append([]string{"--server", s.URL, "--json"}, strings.Fields(command)...)
			switch command {
			case "read":
				args = append(args, "entry 1", "--file", "a + b.md", "--start-line", "2", "--start-column", "3", "--max-lines", "1000")
			case "search", "list":
				if command == "search" {
					args = append(args, "你好 + q")
				}
				args = append(args, "--limit", "100", "--offset", "2", "--type", "articles", "--tag", "Go & CLI", "--status", "archived", "--from", "2026-01-01", "--to", "2026-09-26")
			case "show":
				args = append(args, "entry 1")
			}
			if code := a.run(context.Background(), args); code != 0 {
				t.Fatalf("%d %s", code, err)
			}
			var m map[string]any
			if json.Unmarshal(out.Bytes(), &m) != nil || m["schema_version"] != float64(1) {
				t.Fatal(out.String())
			}
			switch command {
			case "read":
				if got.Get("file") != "a + b.md" || got.Get("id") != "entry 1" || got.Get("start_column") != "3" || m["next_column"] != float64(3) {
					t.Fatal(got, m)
				}
			case "search", "list":
				if got.Get("tag") != "Go & CLI" || got.Get("limit") != "100" {
					t.Fatal(got)
				}
				if command == "search" && got.Get("q") != "你好 + q" {
					t.Fatal(got)
				}
			case "show":
				if _, ok := m["omitted"]; !ok {
					t.Fatal("metadata lost")
				}
			}
		})
	}
}
func TestRedirectsNeverFollowed(t *testing.T) {
	hits := 0
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		t.Error("redirect followed with", r.Header.Get("Authorization"))
	}))
	defer evil.Close()
	for _, status := range []int{301, 302, 303, 307, 308} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, evil.URL, status) }))
			defer s.Close()
			a, _, err := testApp(s.URL)
			if n := a.run(context.Background(), []string{"--server", s.URL, "--json", "list"}); n != exitNetwork || !strings.Contains(err.String(), "redirect_refused") {
				t.Fatalf("%d %s", n, err)
			}
		})
	}
	if hits != 0 {
		t.Fatal(hits)
	}
}
func TestOriginCredentialIsolation(t *testing.T) {
	a, _, err := testApp("https://one.example")
	if n := a.run(context.Background(), []string{"--server", "https://two.example", "list"}); n != exitAuth {
		t.Fatalf("%d %s", n, err)
	}
}
func TestDevicePolling(t *testing.T) {
	for _, tc := range []struct {
		name     string
		sequence []string
		want     int
		delays   []time.Duration
	}{
		{"pending_slow_success", []string{"authorization_pending", "slow_down", "authorization_pending", "ok"}, 0, []time.Duration{5 * time.Second, 5 * time.Second, 10 * time.Second, 10 * time.Second}},
		{"denied", []string{"access_denied"}, exitAuth, []time.Duration{5 * time.Second}},
		{"expired", []string{"expired_token"}, exitAuth, []time.Duration{5 * time.Second}},
		{"invalid_grant", []string{"invalid_grant"}, exitAuth, []time.Duration{5 * time.Second}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var s *httptest.Server
			poll := 0
			s = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" || r.Header.Get("Authorization") != "" {
					t.Error("wrong OAuth encoding or authorization header")
				}
				_ = r.ParseForm()
				if r.Form.Get("client_id") != "lingnest-cli" {
					t.Error(r.Form)
				}
				switch r.URL.Path {
				case "/oauth/device_authorization":
					if r.Form.Get("scope") != "library:read" || r.Form.Get("name") != "测试 + laptop" {
						t.Error(r.Form)
					}
					reply(w, map[string]any{"device_code": "secret + code", "user_code": "ABCD-EFGH", "verification_uri": s.URL + "/device", "verification_uri_complete": s.URL + "/device?user_code=ABCD-EFGH", "expires_in": 600, "interval": 5})
				case "/oauth/token":
					if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:device_code" || r.Form.Get("device_code") != "secret + code" {
						t.Error(r.Form)
					}
					state := tc.sequence[poll]
					poll++
					if state != "ok" {
						w.WriteHeader(400)
						reply(w, map[string]any{"error": state})
						return
					}
					reply(w, map[string]any{"access_token": "sensitive-token", "token_type": "Bearer", "expires_in": 3600, "scope": "library:read"})
				default:
					t.Error(r.URL.Path)
				}
			}))
			defer s.Close()
			a, out, err := testApp(s.URL)
			var delays []time.Duration
			a.store = &memoryStore{data: map[string]credential{}}
			now := time.Now()
			a.now = func() time.Time { return now }
			a.sleep = func(_ context.Context, d time.Duration) error {
				delays = append(delays, d)
				now = now.Add(d)
				return nil
			}
			if n := a.run(context.Background(), []string{"auth", "login", "--server", s.URL, "--json", "--no-browser", "--name", "测试 + laptop"}); n != tc.want {
				t.Fatalf("%d %s", n, err)
			}
			if !reflect.DeepEqual(delays, tc.delays) {
				t.Fatal(delays)
			}
			if strings.Contains(out.String()+err.String(), "sensitive-token") || strings.Contains(out.String()+err.String(), "secret + code") {
				t.Fatal("leaked secret")
			}
			if tc.want == 0 {
				cr, e := a.store.Get(s.URL)
				if e != nil || cr.Token != "sensitive-token" || cr.Origin != s.URL {
					t.Fatal(cr.Origin, e)
				}
			}
		})
	}
}
func TestDeviceDeadlineAndBadScope(t *testing.T) {
	for _, badScope := range []bool{false, true} {
		t.Run(fmt.Sprint(badScope), func(t *testing.T) {
			var s *httptest.Server
			s = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/oauth/device_authorization" {
					ttl := 5
					if badScope {
						ttl = 600
					}
					reply(w, map[string]any{"device_code": "d", "user_code": "u", "verification_uri": s.URL + "/verify", "expires_in": ttl, "interval": 5})
					return
				}
				reply(w, map[string]any{"access_token": "secret", "token_type": "Bearer", "expires_in": 10, "scope": "library:read library:write"})
			}))
			defer s.Close()
			a, _, err := testApp(s.URL)
			a.sleep = func(context.Context, time.Duration) error { return nil }
			a.store = &memoryStore{data: map[string]credential{}}
			want := exitAuth
			if badScope {
				want = exitAPI
			}
			if n := a.run(context.Background(), []string{"--server", s.URL, "auth", "login", "--no-browser"}); n != want {
				t.Fatalf("%d %s", n, err)
			}
		})
	}
}
func TestDownload(t *testing.T) {
	payload := []byte("fixture data\n")
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	other := strings.Repeat("0", 64)
	for _, mode := range []string{"ok", "header_wrong", "body_wrong", "missing_hash", "missing_file", "oversize_meta", "oversize_stream", "wrong_size", "exists", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			fileRequests := 0
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture-token" {
					t.Error("no bearer")
				}
				if r.URL.Path == "/api/read/v1/entry" {
					h := hash
					size := len(payload)
					if mode == "missing_hash" {
						h = ""
					}
					if mode == "oversize_meta" {
						size = maxFile + 1
					}
					if mode == "wrong_size" {
						size++
					}
					files := []any{map[string]any{"path": "source/a.md", "sha256": h, "bytes": size, "role": "source"}}
					if mode == "missing_file" {
						files = nil
					}
					reply(w, map[string]any{"schema_version": 1, "id": "entry", "files": files})
					return
				}
				fileRequests++
				if r.URL.Query().Get("file") != "source/a.md" || r.URL.Query().Get("id") != "entry" {
					t.Error(r.URL.String())
				}
				if mode == "redirect" {
					http.Redirect(w, r, "https://other.example", 302)
					return
				}
				h := hash
				if mode == "header_wrong" {
					h = other
				}
				w.Header().Set("X-Content-SHA256", h)
				switch mode {
				case "body_wrong":
					_, _ = w.Write([]byte("tampered"))
				case "oversize_stream":
					w.(http.Flusher).Flush()
					_, _ = w.Write(bytes.Repeat([]byte("x"), maxFile+1))
				default:
					_, _ = w.Write(payload)
				}
			}))
			defer s.Close()
			outPath := filepath.Join(t.TempDir(), "saved.md")
			if mode == "exists" {
				_ = os.WriteFile(outPath, []byte("keep"), 0600)
			}
			a, _, err := testApp(s.URL)
			n := a.run(context.Background(), []string{"download", "entry", "--server", s.URL, "--file", "source/a.md", "--output", outPath, "--json"})
			switch mode {
			case "ok":
				if n != 0 {
					t.Fatalf("%d %s", n, err)
				}
				b, _ := os.ReadFile(outPath)
				if !bytes.Equal(b, payload) {
					t.Fatal("wrong content")
				}
			case "exists":
				b, _ := os.ReadFile(outPath)
				if n != exitLocal || string(b) != "keep" || fileRequests != 0 {
					t.Fatal(n, string(b), fileRequests)
				}
			default:
				want := exitIntegrity
				if mode == "redirect" {
					want = exitNetwork
				}
				if n != want {
					t.Fatalf("%d %s", n, err)
				}
				if _, e := os.Stat(outPath); !os.IsNotExist(e) {
					t.Fatal("unverified file retained")
				}
			}
		})
	}
}
func TestOpen(t *testing.T) {
	for _, target := range []string{"/?entry=entry", "/reader?id=entry", "https://evil.example/reader", "javascript:alert(1)", "//evil.example/reader"} {
		t.Run(target, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reply(w, map[string]any{"schema_version": 1, "reader_url": target})
			}))
			defer s.Close()
			a, out, err := testApp(s.URL)
			opened := ""
			a.open = func(u string) error { opened = u; return nil }
			n := a.run(context.Background(), []string{"--server", s.URL, "--json", "open", "entry"})
			if strings.HasPrefix(target, "/reader") || strings.HasPrefix(target, "/?entry=") {
				if n != 0 || opened != s.URL+target {
					t.Fatal(n, opened, err.String())
				}
			} else if n != exitAPI || opened != "" {
				t.Fatal(n, opened)
			}
			if strings.Contains(opened+out.String(), "fixture-token") {
				t.Fatal("browser token leak")
			}
		})
	}
}
func TestLogoutFailurePreservesCredential(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/api/read/v1/logout" {
			t.Error(r.Method, r.URL.Path)
		}
		w.WriteHeader(500)
		reply(w, map[string]any{"schema_version": 1, "error": "failed"})
	}))
	defer s.Close()
	a, _, _ := testApp(s.URL)
	if n := a.run(context.Background(), []string{"--server", s.URL, "auth", "logout"}); n != exitAPI {
		t.Fatal(n)
	}
	if _, e := a.store.Get(s.URL); e != nil {
		t.Fatal("credential lost before revocation")
	}
}
func TestJSONErrorsAndSecretRedaction(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		reply(w, map[string]any{"schema_version": 1, "error": "secret fixture-token"})
	}))
	defer s.Close()
	a, out, err := testApp(s.URL)
	if n := a.run(context.Background(), []string{"list", "--json", "--server", s.URL}); n != exitAuth {
		t.Fatal(n)
	}
	var m map[string]any
	if out.Len() != 0 || json.Unmarshal(err.Bytes(), &m) != nil || m["schema_version"] != float64(1) || strings.Contains(err.String(), "fixture-token") {
		t.Fatal(out.String(), err.String())
	}
}
func TestSchemaRejected(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reply(w, map[string]any{"schema_version": 2}) }))
	defer s.Close()
	a, _, _ := testApp(s.URL)
	if n := a.run(context.Background(), []string{"--server", s.URL, "list"}); n != exitAPI {
		t.Fatal(n)
	}
}
