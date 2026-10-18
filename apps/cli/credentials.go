package main

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/zalando/go-keyring"
)

type credential struct {
	Token     string    `json:"token"`
	Origin    string    `json:"origin"`
	ExpiresAt time.Time `json:"expires_at"`
}
type credentialStore interface {
	Get(string) (credential, error)
	Set(string, credential) error
	Delete(string) error
}
type secureStore struct{ service string }

func (s secureStore) Get(server string) (credential, error) {
	raw, e := keyring.Get(s.service, server)
	if errors.Is(e, keyring.ErrNotFound) {
		return credential{}, fail(exitAuth, "not_logged_in", "run auth login for this server")
	}
	if e != nil {
		return credential{}, fail(exitKeyring, "keyring_unavailable", "OS secure credential store is unavailable or locked")
	}
	var c credential
	if json.Unmarshal([]byte(raw), &c) != nil || c.Origin != server || c.Token == "" {
		return credential{}, fail(exitKeyring, "invalid_credential", "invalid origin-bound credential in OS secure store")
	}
	return c, nil
}
func (s secureStore) Set(server string, c credential) error {
	raw, e := json.Marshal(c)
	if e != nil {
		return fail(exitKeyring, "keyring_write_failed", "cannot encode credential")
	}
	if e = keyring.Set(s.service, server, string(raw)); e != nil {
		return fail(exitKeyring, "keyring_write_failed", "cannot save credential in OS secure store; no plaintext fallback")
	}
	return nil
}
func (s secureStore) Delete(server string) error {
	if e := keyring.Delete(s.service, server); e != nil && !errors.Is(e, keyring.ErrNotFound) {
		return fail(exitKeyring, "keyring_delete_failed", "cannot remove credential from OS secure store")
	}
	return nil
}
