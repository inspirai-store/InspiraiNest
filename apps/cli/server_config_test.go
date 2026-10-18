package main

import "testing"

func TestSelfHostedServerSelection(t *testing.T) {
	t.Setenv("LINGNEST_SERVER", "https://configured.example")
	o, err := parse([]string{"list"})
	if err != nil || o.server != "https://configured.example" {
		t.Fatalf("environment origin not selected: %v", err)
	}
	o, err = parse([]string{"--server", "https://override.example", "list"})
	if err != nil || o.server != "https://override.example" {
		t.Fatalf("explicit origin must win: %v", err)
	}
	t.Setenv("LINGNEST_SERVER", "")
	o, err = parse([]string{"list"})
	if err != nil || o.server != "http://127.0.0.1:4317" {
		t.Fatalf("default must stay on loopback: %v", err)
	}
}
