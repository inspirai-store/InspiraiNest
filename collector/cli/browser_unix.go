//go:build darwin || linux

package main

import (
	"os/exec"
	"runtime"
)

func openBrowser(target string) error {
	program := "xdg-open"
	if runtime.GOOS == "darwin" {
		program = "/usr/bin/open"
	}
	return exec.Command(program, target).Run()
}
