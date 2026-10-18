package main

import "golang.org/x/sys/windows"

func openBrowser(target string) error {
	verb, e := windows.UTF16PtrFromString("open")
	if e != nil {
		return e
	}
	path, e := windows.UTF16PtrFromString(target)
	if e != nil {
		return e
	}
	return windows.ShellExecute(0, verb, path, nil, nil, windows.SW_SHOWNORMAL)
}
