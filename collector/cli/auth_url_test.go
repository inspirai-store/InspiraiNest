package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoginPrintsTheCompleteBrowserURL(t *testing.T) {
	for _, tc := range []struct {
		name, complete       string
		noBrowser, openFails bool
	}{
		{name: "auto_open", complete: "/authorize#code=ABCD-1234"},
		{name: "manual_link", complete: "/authorize#code=ABCD-1234", noBrowser: true},
		{name: "browser_failure", complete: "/authorize#code=ABCD-1234", openFails: true},
		{name: "query_link", complete: "/authorize?user_code=ABCD-1234"},
		{name: "legacy_verification_url"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/oauth/device_authorization" {
					t.Error("Unexpected OAuth poll")
					w.WriteHeader(http.StatusNotFound)
					return
				}
				reply(w, map[string]any{"device_code": "private-device-secret", "user_code": "ABCD-1234", "verification_uri": server.URL + "/authorize", "verification_uri_complete": tc.complete, "expires_in": 600, "interval": 5})
			}))
			defer server.Close()
			a, out, stderr := testApp(server.URL)
			a.store = &memoryStore{data: map[string]credential{}}
			opened := ""
			a.open = func(target string) error {
				opened = target
				if tc.openFails {
					return errors.New("browser unavailable")
				}
				return nil
			}
			a.sleep = func(context.Context, time.Duration) error { return context.Canceled }
			args := []string{"--server", server.URL, "--json", "auth", "login"}
			if tc.noBrowser {
				args = append(args, "--no-browser")
			}
			if n := a.run(context.Background(), args); n != exitAuth {
				t.Fatalf("exit %d: %s", n, stderr)
			}
			want := server.URL + tc.complete
			if tc.complete == "" {
				want = server.URL + "/authorize"
			}
			if !strings.Contains(stderr.String(), "Authorize this device at "+want+"\nCode: ABCD-1234\n") {
				t.Fatal(stderr.String())
			}
			if tc.noBrowser && opened != "" || !tc.noBrowser && opened != want {
				t.Fatalf("opened %q, expected %q", opened, want)
			}
			if tc.openFails && !strings.Contains(stderr.String(), "Browser could not be opened") {
				t.Fatal(stderr.String())
			}
			if strings.Contains(out.String()+stderr.String(), "private-device-secret") {
				t.Fatal("device secret leaked")
			}
		})
	}
}

func TestLoginRejectsExternalCompleteAuthorizationURL(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]any{"device_code": "private-device-secret", "user_code": "ABCD-1234", "verification_uri": server.URL + "/authorize", "verification_uri_complete": "https://other.invalid/authorize#code=ABCD-1234", "expires_in": 600, "interval": 5})
	}))
	defer server.Close()
	a, out, stderr := testApp(server.URL)
	a.store = &memoryStore{data: map[string]credential{}}
	a.open = func(string) error { t.Fatal("Unsafe URL opened"); return nil }
	if n := a.run(context.Background(), []string{"--server", server.URL, "--json", "auth", "login"}); n != exitAPI {
		t.Fatal(n)
	}
	if !strings.Contains(stderr.String(), "unsafe_url") || strings.Contains(out.String()+stderr.String(), "other.invalid") {
		t.Fatal(stderr.String())
	}
}
