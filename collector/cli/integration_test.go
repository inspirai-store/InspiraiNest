package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func requireKeyring(t *testing.T) {
	t.Helper()
	if os.Getenv("LINGNEST_KEYRING_INTEGRATION") != "1" {
		t.Skip("set LINGNEST_KEYRING_INTEGRATION=1 to exercise the real OS secure store")
	}
}

// This test uses a unique service and deletes only the item it creates.
func TestOSKeyring(t *testing.T) {
	requireKeyring(t)
	s := secureStore{fmt.Sprintf("InspiraiNest CLI integration %d", time.Now().UnixNano())}
	origin := "https://keyring-fixture.invalid"
	cr := credential{Token: "keyring-fixture-not-a-live-token", Origin: origin, ExpiresAt: time.Now().UTC().Truncate(time.Second).Add(time.Hour)}
	t.Cleanup(func() {
		if e := s.Delete(origin); e != nil {
			t.Error(e)
		}
	})
	if e := s.Set(origin, cr); e != nil {
		t.Fatal(e)
	}
	actual, e := s.Get(origin)
	if e != nil || actual != cr {
		t.Fatal("secure store round trip failed", e)
	}
	if _, e = s.Get("https://different-origin.invalid"); errorCode(e) != "not_logged_in" {
		t.Fatal("origin isolation failed", e)
	}
	if e = s.Delete(origin); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Get(origin); errorCode(e) != "not_logged_in" {
		t.Fatal("secure store deletion failed", e)
	}
	t.Logf("actual %s/%s OS keyring set/get/isolation/delete verified", runtime.GOOS, runtime.GOARCH)
}

// Builds and executes the unmodified production binary. No test credential backend
// or token environment variable exists in that binary. Each invocation reads the OS store.
func TestCLIIntegration(t *testing.T) {
	requireKeyring(t)
	binary := filepath.Join(t.TempDir(), "lingnest")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "build", "-o", binary, ".")
	if b, e := build.CombinedOutput(); e != nil {
		t.Fatalf("build: %v %s", e, b)
	}
	payload := []byte("# Fixture\nHello 世界 😀\n")
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	var mu sync.Mutex
	polls := 0
	revoked := false
	seen := map[string]int{}
	var s *httptest.Server
	s = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		seen[r.URL.Path]++
		switch r.URL.Path {
		case "/oauth/device_authorization":
			_ = r.ParseForm()
			if r.Method != "POST" || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" || r.Form.Get("client_id") != "lingnest-cli" || r.Form.Get("name") != "fixture + 设备" || r.Form.Get("scope") != "library:read" {
				t.Error("device authorization contract", r.Form)
			}
			reply(w, map[string]any{"device_code": "fixture-device-secret", "user_code": "ABCD-1234", "verification_uri": s.URL + "/device", "verification_uri_complete": s.URL + "/device?user_code=ABCD-1234", "expires_in": 600, "interval": 1})
			return
		case "/oauth/token":
			_ = r.ParseForm()
			if r.Form.Get("device_code") != "fixture-device-secret" || r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:device_code" || r.Form.Get("client_id") != "lingnest-cli" || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
				t.Error("token contract", r.Form)
			}
			polls++
			if polls == 1 {
				w.WriteHeader(400)
				reply(w, map[string]any{"error": "authorization_pending"})
				return
			}
			reply(w, map[string]any{"access_token": "fixture-integration-token", "token_type": "Bearer", "expires_in": 3600, "scope": "library:read"})
			return
		}
		if revoked || r.Header.Get("Authorization") != "Bearer fixture-integration-token" {
			w.WriteHeader(401)
			reply(w, map[string]any{"schema_version": 1, "error": "unauthorized"})
			return
		}
		switch r.URL.Path {
		case "/api/read/v1/me":
			reply(w, map[string]any{"schema_version": 1, "device": map[string]any{"id": "fixture-device", "name": "fixture + 设备", "role": "reader", "scope": "library:read", "createdAt": "2026-01-01T00:00:00Z", "expiresAt": "2027-01-01T00:00:00Z", "lastSeen": nil}})
		case "/api/read/v1/entries", "/api/read/v1/search":
			reply(w, map[string]any{"schema_version": 1, "items": []any{map[string]any{"id": "entry", "title": "Fixture", "matches": []any{map[string]any{"file": "summary.md", "start_line": 1, "end_line": 2, "snippet": "Hello 世界"}}}}, "total": 1, "limit": 20, "offset": 0, "index": map[string]any{"complete": 1, "pending": 0, "failed": 0}})
		case "/api/read/v1/entry":
			reply(w, map[string]any{"schema_version": 1, "id": "entry", "archive_id": "archive", "title": "Fixture", "reader_url": s.URL + "/reader?id=entry", "files": []any{map[string]any{"path": "summary.md", "role": "summary", "bytes": len(payload), "sha256": hash}}, "omitted": []any{}})
		case "/api/read/v1/content":
			reply(w, map[string]any{"schema_version": 1, "id": "entry", "archive_id": "archive", "file": "summary.md", "content": string(payload), "start_line": 1, "end_line": 2, "next_line": nil, "next_column": nil, "total_lines": 2, "truncated": false, "source_url": "https://source.invalid", "reader_url": s.URL + "/reader?id=entry"})
		case "/api/read/v1/file":
			w.Header().Set("X-Content-SHA256", hash)
			_, _ = w.Write(payload)
		case "/api/read/v1/logout":
			var b map[string]any
			if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" || json.NewDecoder(r.Body).Decode(&b) != nil || len(b) != 0 {
				t.Error("logout must POST {}")
			}
			revoked = true
			reply(w, map[string]any{"schema_version": 1, "ok": true})
		default:
			t.Error("unexpected request", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	t.Cleanup(func() {
		if e := (secureStore{"LingNest CLI"}).Delete(s.URL); e != nil {
			t.Error(e)
		}
	})
	run := func(want int, args ...string) map[string]any {
		t.Helper()
		cmd := exec.Command(binary, append([]string{"--server", s.URL, "--json"}, args...)...)
		var out, err bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &err
		e := cmd.Run()
		code := 0
		if e != nil {
			if x, ok := e.(*exec.ExitError); ok {
				code = x.ExitCode()
			} else {
				t.Fatal(e)
			}
		}
		if code != want {
			t.Fatalf("%v: exit %d wanted %d stderr=%s", args, code, want, err.String())
		}
		if strings.Contains(out.String()+err.String(), "fixture-integration-token") || strings.Contains(out.String()+err.String(), "fixture-device-secret") {
			t.Fatal("credential leaked")
		}
		var obj map[string]any
		if want == 0 {
			if json.Unmarshal(out.Bytes(), &obj) != nil || obj["schema_version"] != float64(1) {
				t.Fatal("invalid stdout JSON", out.String())
			}
		} else {
			if out.Len() != 0 || json.Unmarshal(err.Bytes(), &obj) != nil {
				t.Fatal("invalid error streams")
			}
		}
		return obj
	}
	run(exitAuth, "auth", "status")
	run(0, "auth", "login", "--name", "fixture + 设备", "--no-browser")
	run(0, "auth", "status")
	run(0, "list", "--tag", "Go", "--limit", "20")
	run(0, "search", "世界", "--offset", "0")
	show := run(0, "show", "entry")
	if show["archive_id"] != "archive" {
		t.Fatal(show)
	}
	content := run(0, "read", "entry", "--file", "summary.md", "--start-column", "0")
	if content["content"] != string(payload) {
		t.Fatal("content changed")
	}
	dest := filepath.Join(t.TempDir(), "summary.md")
	run(0, "download", "entry", "--file", "summary.md", "--output", dest)
	b, e := os.ReadFile(dest)
	if e != nil || !bytes.Equal(b, payload) {
		t.Fatal("download mismatch", e)
	}
	run(exitLocal, "download", "entry", "--file", "summary.md", "--output", dest)
	run(0, "auth", "logout")
	run(exitAuth, "auth", "status")
	mu.Lock()
	defer mu.Unlock()
	if !revoked || polls != 2 {
		t.Fatal("device grant/revocation not completed")
	}
	for _, path := range []string{"me", "entries", "search", "entry", "content", "file", "logout"} {
		if seen["/api/read/v1/"+path] == 0 {
			t.Fatal("missing endpoint", path)
		}
	}
	t.Log("production binary: login/pending/status/list/search/show/read/download/no-overwrite/logout passed with real OS keyring")
}
