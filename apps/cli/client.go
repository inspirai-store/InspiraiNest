package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxFile = 16 << 20
const defaultServer = "http://127.0.0.1:4317"

// Exit codes are stable CLI API. Never include request bodies or credentials in errors.
const (
	exitUsage     = 2
	exitAuth      = 3
	exitNetwork   = 4
	exitAPI       = 5
	exitIntegrity = 6
	exitLocal     = 7
	exitKeyring   = 8
	exitNotFound  = 9
	exitForbidden = 10
	exitRateLimit = 11
)

type failure struct {
	Exit          int
	Code, Message string
}

func (e *failure) Error() string         { return e.Message }
func fail(n int, code, msg string) error { return &failure{n, code, msg} }

func origin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", fail(exitUsage, "invalid_server", "server must be an absolute origin without credentials, path, query or fragment")
	}
	host := strings.ToLower(u.Hostname())
	ip := net.ParseIP(host)
	if u.Scheme != "https" && !(u.Scheme == "http" && (host == "localhost" || (ip != nil && ip.IsLoopback()))) {
		return "", fail(exitUsage, "insecure_server", "HTTPS is required except for loopback servers")
	}
	port := u.Port()
	if port != "" {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 {
			return "", fail(exitUsage, "invalid_server", "invalid server port")
		}
	}
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		host += ":" + port
	}
	return u.Scheme + "://" + host, nil
}

type client struct {
	origin, token string
	http          *http.Client
}

func newClient(server string) *client {
	return &client{origin: server, http: &http.Client{Timeout: 30 * time.Second,
		// Reject every redirect: also prevents same-origin POST rewrites or credential replay.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}
func (c *client) request(ctx context.Context, method, path string, q url.Values, body []byte, contentType string) (*http.Response, error) {
	target := c.origin + path
	if len(q) > 0 {
		target += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return nil, fail(exitNetwork, "request_failed", "cannot create request")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "lingnest-cli/"+version)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fail(exitNetwork, "network_error", "request failed (connection, TLS, timeout or cancellation)")
	}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		resp.Body.Close()
		return nil, fail(exitNetwork, "redirect_refused", "server redirect refused")
	}
	return resp, nil
}
func readBounded(r io.Reader, limit int64) ([]byte, error) {
	b, e := io.ReadAll(io.LimitReader(r, limit+1))
	if e != nil {
		return nil, fail(exitNetwork, "read_failed", "response body could not be read")
	}
	if int64(len(b)) > limit {
		return nil, fail(exitIntegrity, "response_too_large", "response exceeds size limit")
	}
	return b, nil
}
func apiError(status int, b []byte) error {
	var obj struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(b, &obj)
	code := obj.Code
	if code == "" {
		code = obj.Error
	}
	// Only allow known machine codes into output; upstream text may echo secrets.
	switch code {
	case "authorization_pending", "slow_down", "access_denied", "expired_token", "invalid_grant", "invalid_token", "unauthorized", "forbidden", "not_found", "invalid_request", "invalid_scope", "unsupported_grant_type", "rate_limited", "service_unavailable":
	default:
		switch status {
		case 401:
			code = "unauthorized"
		case 403:
			code = "forbidden"
		case 404:
			code = "not_found"
		case 429:
			code = "rate_limited"
		case 503:
			code = "service_unavailable"
		default:
			code = "api_error"
		}
	}
	n := exitAPI
	switch code {
	case "unauthorized", "invalid_token", "access_denied", "expired_token", "invalid_grant":
		n = exitAuth
	case "forbidden":
		n = exitForbidden
	case "not_found":
		n = exitNotFound
	case "rate_limited":
		n = exitRateLimit
	}
	return fail(n, code, fmt.Sprintf("server returned HTTP %d (%s)", status, code))
}
func (c *client) json(ctx context.Context, method, path string, q url.Values, body []byte, ct string, schema bool) (map[string]any, error) {
	r, e := c.request(ctx, method, path, q, body, ct)
	if e != nil {
		return nil, e
	}
	defer r.Body.Close()
	b, e := readBounded(r.Body, maxFile)
	if e != nil {
		return nil, e
	}
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		return nil, apiError(r.StatusCode, b)
	}
	var obj map[string]any
	if json.Unmarshal(b, &obj) != nil || obj == nil {
		return nil, fail(exitAPI, "invalid_response", "server returned invalid JSON object")
	}
	if schema && obj["schema_version"] != float64(1) {
		return nil, fail(exitAPI, "schema_mismatch", "expected schema_version 1")
	}
	return obj, nil
}
func (c *client) get(ctx context.Context, path string, q url.Values) (map[string]any, error) {
	return c.json(ctx, http.MethodGet, "/api/read/v1/"+path, q, nil, "", true)
}
func stringField(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func integer(m map[string]any, k string) int {
	f, _ := m[k].(float64)
	if f < 0 || f > 2147483647 || f != float64(int(f)) {
		return 0
	}
	return int(f)
}
func errorCode(err error) string {
	var f *failure
	if errors.As(err, &f) {
		return f.Code
	}
	return "internal_error"
}
