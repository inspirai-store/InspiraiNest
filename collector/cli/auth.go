package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
)

func safeURL(raw, server string) (string, error) {
	u, e := url.Parse(raw)
	if e != nil {
		return "", fail(exitAPI, "unsafe_url", "invalid browser URL")
	}
	base, _ := url.Parse(server)
	u = base.ResolveReference(u)
	copyURL := *u
	copyURL.Path = ""
	copyURL.RawPath = ""
	copyURL.RawQuery = ""
	copyURL.ForceQuery = false
	copyURL.Fragment = ""
	o, e := origin(copyURL.String())
	if e != nil || o != server {
		return "", fail(exitAPI, "unsafe_url", "browser URL must use the configured server origin")
	}
	return u.String(), nil
}

func (a *app) login(ctx context.Context, c *client, o options) (map[string]any, error) {
	// One secure-store slot per origin: never silently replace a live authorization.
	cr, existingErr := a.store.Get(c.origin)
	if existingErr != nil && errorCode(existingErr) != "not_logged_in" {
		return nil, existingErr
	}
	if existingErr == nil {
		if cr.Origin != c.origin || !validToken(cr.Token) {
			return nil, fail(exitKeyring, "invalid_credential", "invalid origin-bound credential in OS secure store")
		}
		if a.now().Before(cr.ExpiresAt) {
			c.token = cr.Token
			_, e := c.get(ctx, "me", nil)
			c.token = ""
			if e == nil {
				return nil, fail(exitAuth, "already_authenticated", "already authenticated for this server; use auth status or auth logout before logging in again")
			}
			if errorCode(e) != "unauthorized" && errorCode(e) != "invalid_token" && errorCode(e) != "expired_token" {
				return nil, e
			}
		}
	}
	start := a.now()
	form := url.Values{"client_id": {"lingnest-cli"}, "scope": {"library:read"}, "name": {o.name}}
	d, e := c.json(ctx, "POST", "/oauth/device_authorization", nil, []byte(form.Encode()), "application/x-www-form-urlencoded", false)
	if e != nil {
		return nil, e
	}
	code := stringField(d, "device_code")
	user := stringField(d, "user_code")
	expires := integer(d, "expires_in")
	interval := integer(d, "interval")
	if code == "" || user == "" || expires <= 0 || expires > 86400 {
		return nil, fail(exitAPI, "invalid_device_response", "invalid device authorization response")
	}
	if interval == 0 {
		interval = 5
	}
	verify, e := safeURL(stringField(d, "verification_uri"), c.origin)
	if e != nil || stringField(d, "verification_uri") == "" {
		return nil, fail(exitAPI, "unsafe_url", "invalid verification URL")
	}
	browserURL := verify
	if full := stringField(d, "verification_uri_complete"); full != "" {
		browserURL, e = safeURL(full, c.origin)
		if e != nil {
			return nil, e
		}
	}
	fmt.Fprintf(a.err, "Authorize this device at %s\nCode: %s\n", verify, terminal(user))
	if !o.noBrowser {
		if e = a.open(browserURL); e != nil {
			fmt.Fprintln(a.err, "Browser could not be opened; use the verification URL above.")
		}
	}
	deadline := start.Add(time.Duration(expires) * time.Second)
	pollCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	delay := time.Duration(interval) * time.Second
	for {
		if !a.now().Add(delay).Before(deadline) {
			return nil, fail(exitAuth, "expired_token", "device authorization expired; run auth login again")
		}
		if e = a.sleep(pollCtx, delay); e != nil {
			return nil, fail(exitAuth, "login_cancelled", "device authorization cancelled or expired")
		}
		f := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}, "device_code": {code}, "client_id": {"lingnest-cli"}}
		token, e := c.json(pollCtx, "POST", "/oauth/token", nil, []byte(f.Encode()), "application/x-www-form-urlencoded", false)
		if e != nil {
			switch errorCode(e) {
			case "authorization_pending":
				continue
			case "slow_down":
				delay += 5 * time.Second
				continue
			case "network_error":
				if pollCtx.Err() != nil {
					return nil, fail(exitAuth, "expired_token", "device authorization expired or cancelled")
				}
				delay *= 2
				continue
			default:
				return nil, e
			}
		}
		access := stringField(token, "access_token")
		ttl := integer(token, "expires_in")
		scope := strings.Fields(stringField(token, "scope"))
		if !strings.EqualFold(stringField(token, "token_type"), "Bearer") || !validToken(access) || ttl <= 0 || len(scope) != 1 || scope[0] != "library:read" {
			return nil, fail(exitAPI, "invalid_token_response", "invalid token type, expiry or read-only scope")
		}
		saved := credential{Token: access, Origin: c.origin, ExpiresAt: a.now().Add(time.Duration(ttl) * time.Second)}
		if e = a.store.Set(c.origin, saved); e != nil {
			c.token = access
			_, revokeErr := c.json(ctx, "POST", "/api/read/v1/logout", nil, []byte("{}"), "application/json", true)
			if revokeErr != nil {
				fmt.Fprintln(a.err, "Could not revoke unsaved token; revoke this device in the website.")
			}
			return nil, e
		}
		return map[string]any{"schema_version": 1, "authenticated": true, "server": c.origin, "expires_at": saved.ExpiresAt, "scope": "library:read"}, nil
	}
}
func validToken(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-._~+/=", r)) {
			return false
		}
	}
	return true
}

func (a *app) authorize(c *client, allowExpired bool) error {
	cr, e := a.store.Get(c.origin)
	if e != nil {
		return e
	}
	if cr.Origin != c.origin || !validToken(cr.Token) {
		return fail(exitKeyring, "invalid_credential", "credential does not match server origin or token format")
	}
	if !allowExpired && !a.now().Before(cr.ExpiresAt) {
		return fail(exitAuth, "expired_credential", "saved login has expired; run auth login again")
	}
	c.token = cr.Token
	return nil
}
func (a *app) logout(ctx context.Context, c *client) (map[string]any, error) {
	e := a.authorize(c, true)
	if errorCode(e) == "not_logged_in" {
		return map[string]any{"schema_version": 1, "authenticated": false, "server": c.origin}, nil
	}
	if e != nil {
		return nil, e
	}
	_, e = c.json(ctx, "POST", "/api/read/v1/logout", nil, []byte("{}"), "application/json", true)
	if e != nil && errorCode(e) != "invalid_token" && errorCode(e) != "unauthorized" && errorCode(e) != "expired_token" {
		return nil, e
	}
	if e = a.store.Delete(c.origin); e != nil {
		return nil, e
	}
	return map[string]any{"schema_version": 1, "authenticated": false, "server": c.origin}, nil
}
