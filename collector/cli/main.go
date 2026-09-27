package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

var version = "dev"

type options struct {
	server, name, output  string
	json, noBrowser, help bool
	command               string
	args                  []string
	query                 url.Values
}

const usage = `InspiraiNest read-only CLI
Usage: lingnest [--server ORIGIN] [--json] COMMAND
  auth login [--name NAME] [--no-browser]
  auth status | auth logout
  list [--type TYPE] [--tag TAG] [--status STATUS] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit 1..100] [--offset N]
  search QUERY [same filters as list]
  show ID
  read ID [--file PATH] [--start-line N] [--max-lines 1..1000] [--start-column N]
  download ID --file PATH --output LOCAL_PATH
  open ID
  version
Flags may appear before or after positional arguments. Use -- before positional values starting with -.
JSON successes go to stdout; diagnostics and JSON errors go to stderr.
Browser sessions require their own website login. CLI credentials are never sent to the browser.
`

func parse(args []string) (options, error) {
	host, _ := os.Hostname()
	if host == "" {
		host = "InspiraiNest CLI"
	}
	server := os.Getenv("LINGNEST_SERVER")
	if server == "" {
		server = defaultServer
	}
	o := options{server: server, name: host, query: url.Values{}}
	var pos []string
	seen := map[string]bool{}
	for i := 0; i < len(args); i++ {
		v := args[i]
		if v == "--" {
			pos = append(pos, args[i+1:]...)
			break
		}
		if v == "-h" {
			v = "--help"
		}
		if !strings.HasPrefix(v, "--") {
			if strings.HasPrefix(v, "-") {
				return o, fail(exitUsage, "invalid_argument", "unknown option")
			}
			pos = append(pos, v)
			continue
		}
		key, val, has := strings.Cut(strings.TrimPrefix(v, "--"), "=")
		if seen[key] {
			return o, fail(exitUsage, "invalid_argument", "duplicate option: --"+key)
		}
		seen[key] = true
		switch key {
		case "json", "no-browser", "help":
			if has {
				return o, fail(exitUsage, "invalid_argument", "boolean options do not accept values")
			}
			switch key {
			case "json":
				o.json = true
			case "no-browser":
				o.noBrowser = true
			case "help":
				o.help = true
			}
			continue
		case "server", "name", "output", "file", "type", "tag", "status", "from", "to", "limit", "offset", "start-line", "max-lines", "start-column":
		default:
			return o, fail(exitUsage, "invalid_argument", "unknown option: --"+key)
		}
		if !has {
			i++
			if i >= len(args) || strings.HasPrefix(args[i], "--") {
				return o, fail(exitUsage, "invalid_argument", "missing value for --"+key)
			}
			val = args[i]
		}
		if val == "" {
			return o, fail(exitUsage, "invalid_argument", "empty value for --"+key)
		}
		switch key {
		case "server":
			o.server = val
		case "name":
			o.name = val
		case "output":
			o.output = val
		default:
			o.query.Set(strings.ReplaceAll(key, "-", "_"), val)
		}
	}
	if o.help {
		return o, nil
	}
	if len(pos) == 0 {
		return o, fail(exitUsage, "invalid_argument", "a command is required; use --help")
	}
	o.command = pos[0]
	o.args = pos[1:]
	if o.command == "auth" {
		if len(o.args) == 0 {
			return o, fail(exitUsage, "invalid_argument", "auth requires login, status or logout")
		}
		o.command += " " + o.args[0]
		o.args = o.args[1:]
	}
	allowed := "server json help"
	want := 0
	switch o.command {
	case "auth login":
		allowed += " name no-browser"
	case "auth status", "auth logout", "version":
	case "list", "search":
		allowed += " type tag status from to limit offset"
		if o.command == "search" {
			want = 1
		}
	case "show", "open":
		want = 1
	case "read":
		want = 1
		allowed += " file start-line max-lines start-column"
	case "download":
		want = 1
		allowed += " file output"
	default:
		return o, fail(exitUsage, "invalid_argument", "unknown command; use --help")
	}
	for k := range seen {
		if !strings.Contains(" "+allowed+" ", " "+k+" ") {
			return o, fail(exitUsage, "invalid_argument", "--"+k+" is not supported for this command")
		}
	}
	if len(o.args) != want {
		return o, fail(exitUsage, "invalid_argument", "incorrect positional arguments; use --help")
	}
	for _, s := range o.args {
		if strings.TrimSpace(s) == "" {
			return o, fail(exitUsage, "invalid_argument", "empty argument")
		}
	}
	for _, k := range []string{"limit", "offset", "start_line", "max_lines", "start_column"} {
		if v := o.query.Get(k); v != "" {
			n, e := strconv.Atoi(v)
			min := 0
			max := int(^uint(0) >> 1)
			switch k {
			case "limit":
				min = 1
				max = 100
			case "max_lines":
				min = 1
				max = 1000
			case "start_line":
				min = 1
			}
			if e != nil || n < min || n > max {
				return o, fail(exitUsage, "invalid_argument", "invalid "+k)
			}
		}
	}
	for _, k := range []string{"from", "to"} {
		if v := o.query.Get(k); v != "" {
			if _, e := time.Parse("2006-01-02", v); e != nil {
				return o, fail(exitUsage, "invalid_argument", "dates must use YYYY-MM-DD")
			}
		}
	}
	if o.query.Get("from") != "" && o.query.Get("to") != "" && o.query.Get("from") > o.query.Get("to") {
		return o, fail(exitUsage, "invalid_argument", "from must not be after to")
	}
	if o.command == "download" && (o.output == "" || o.query.Get("file") == "") {
		return o, fail(exitUsage, "invalid_argument", "download requires --file and --output")
	}
	if o.command == "read" {
		if !seen["start-line"] {
			o.query.Set("start_line", "1")
		}
		if !seen["max-lines"] {
			o.query.Set("max_lines", "200")
		}
	}
	var e error
	o.server, e = origin(o.server)
	return o, e
}

type app struct {
	store    credentialStore
	out, err io.Writer
	now      func() time.Time
	sleep    func(context.Context, time.Duration) error
	open     func(string) error
}

func newApp(out, err io.Writer) *app {
	return &app{store: secureStore{"LingNest CLI"}, out: out, err: err, now: time.Now, open: openBrowser, sleep: func(ctx context.Context, d time.Duration) error {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-t.C:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
}
func (a *app) run(ctx context.Context, args []string) int {
	o, e := parse(args)
	// Recognize JSON even if parsing failed before reaching it.
	for _, v := range args {
		if v == "--" {
			break
		}
		if v == "--json" {
			o.json = true
		}
	}
	if e == nil && o.help {
		if o.json {
			e = json.NewEncoder(a.out).Encode(map[string]any{"schema_version": 1, "help": usage})
		} else {
			_, e = fmt.Fprint(a.out, usage)
		}
		if e == nil {
			return 0
		}
	}
	var result map[string]any
	if e == nil {
		result, e = a.execute(ctx, o)
	}
	if e == nil {
		if o.json {
			e = json.NewEncoder(a.out).Encode(result)
		} else {
			e = human(a.out, o.command, result)
		}
	}
	if e == nil {
		return 0
	}
	var f *failure
	if !errors.As(e, &f) {
		f = &failure{exitLocal, "local_io_error", "local input/output failed"}
	}
	if o.json {
		_ = json.NewEncoder(a.err).Encode(map[string]any{"schema_version": 1, "error": f.Message, "code": f.Code})
	} else {
		fmt.Fprintf(a.err, "lingnest: %s\n", f.Message)
	}
	return f.Exit
}
func (a *app) execute(ctx context.Context, o options) (map[string]any, error) {
	if o.command == "version" {
		return map[string]any{"schema_version": 1, "version": version}, nil
	}
	c := newClient(o.server)
	if o.command == "auth login" {
		return a.login(ctx, c, o)
	}
	if o.command == "auth logout" {
		return a.logout(ctx, c)
	}
	if e := a.authorize(c, false); e != nil {
		return nil, e
	}
	q := o.query
	switch o.command {
	case "auth status":
		return c.get(ctx, "me", nil)
	case "list":
		return c.get(ctx, "entries", q)
	case "search":
		q.Set("q", o.args[0])
		return c.get(ctx, "search", q)
	case "show":
		q.Set("id", o.args[0])
		return c.get(ctx, "entry", q)
	case "read":
		q.Set("id", o.args[0])
		result, e := c.get(ctx, "content", q)
		if e == nil && !o.json {
			fmt.Fprintf(a.err, "File: %s  Lines: %v-%v / %v\n", terminal(stringField(result, "file")), result["start_line"], result["end_line"], result["total_lines"])
			if source := stringField(result, "source_url"); source != "" {
				fmt.Fprintln(a.err, "Source:", terminal(source))
			}
			if reader := stringField(result, "reader_url"); reader != "" {
				fmt.Fprintln(a.err, "Reader:", terminal(reader))
			}
			if result["truncated"] == true {
				if next := integer(result, "next_line"); next > 0 {
					fmt.Fprintf(a.err, "PARTIAL CONTENT: continue with --start-line %d --start-column %d (UTF-16), using the same id and file.\n", next, integer(result, "next_column"))
				} else {
					fmt.Fprintln(a.err, "PARTIAL CONTENT: server did not provide a valid continuation cursor.")
				}
			}
		}
		return result, e
	case "download":
		return a.download(ctx, c, o)
	case "open":
		item, e := c.get(ctx, "entry", url.Values{"id": {o.args[0]}})
		if e != nil {
			return nil, e
		}
		raw := stringField(item, "reader_url")
		if raw == "" {
			return nil, fail(exitAPI, "invalid_response", "entry has no reader_url")
		}
		target, e := safeURL(raw, c.origin)
		if e != nil {
			return nil, e
		}
		if e = a.open(target); e != nil {
			return nil, fail(exitLocal, "browser_failed", "cannot open default browser")
		}
		fmt.Fprintln(a.err, "Opened website; the browser requires its own login.")
		return map[string]any{"schema_version": 1, "opened": true, "reader_url": target}, nil
	}
	return nil, fail(exitUsage, "invalid_argument", "unknown command")
}
func terminal(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, s)
}
func human(w io.Writer, command string, m map[string]any) error {
	if command == "read" {
		_, e := fmt.Fprint(w, terminal(stringField(m, "content")))
		return e
	}
	if command == "list" || command == "search" {
		items, _ := m["items"].([]any)
		for _, v := range items {
			item, _ := v.(map[string]any)
			if _, e := fmt.Fprintf(w, "%s\t%s\n", terminal(stringField(item, "id")), terminal(stringField(item, "title"))); e != nil {
				return e
			}
			matches, _ := item["matches"].([]any)
			for _, match := range matches {
				x, _ := match.(map[string]any)
				if _, e := fmt.Fprintf(w, "  %s:%v-%v  %s\n", terminal(stringField(x, "file")), x["start_line"], x["end_line"], terminal(stringField(x, "snippet"))); e != nil {
					return e
				}
			}
		}
		if _, e := fmt.Fprintf(w, "Total: %v  Offset: %v  Limit: %v\n", m["total"], m["offset"], m["limit"]); e != nil {
			return e
		}
		index, ok := m["index"].(map[string]any)
		if !ok {
			_, e := fmt.Fprintln(w, "Index coverage: unknown; completeness cannot be established.")
			return e
		}
		if _, e := fmt.Fprintf(w, "Index: complete=%v pending=%v failed=%v\n", index["complete"], index["pending"], index["failed"]); e != nil {
			return e
		}
		if integer(index, "pending") > 0 || integer(index, "failed") > 0 {
			_, e := fmt.Fprintln(w, "INCOMPLETE INDEX: results may omit pending or failed entries.")
			return e
		}
		return nil
	}
	if command == "version" {
		_, e := fmt.Fprintln(w, "lingnest", stringField(m, "version"))
		return e
	}
	if command == "auth login" {
		_, e := fmt.Fprintln(w, "Logged in to", stringField(m, "server"))
		return e
	}
	if command == "auth logout" {
		_, e := fmt.Fprintln(w, "Logged out of", stringField(m, "server"))
		return e
	}
	return humanFields(w, m, "")
}

// Human metadata output retains fields without forcing JSON on interactive users.
func humanFields(w io.Writer, m map[string]any, indent string) error {
	keys := make([]string, 0, len(m))
	for k := range m {
		if k != "schema_version" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		switch v := m[k].(type) {
		case map[string]any:
			if _, e := fmt.Fprintf(w, "%s%s:\n", indent, terminal(k)); e != nil {
				return e
			}
			if e := humanFields(w, v, indent+"  "); e != nil {
				return e
			}
		case []any:
			if _, e := fmt.Fprintf(w, "%s%s:\n", indent, terminal(k)); e != nil {
				return e
			}
			for _, item := range v {
				if obj, ok := item.(map[string]any); ok {
					if e := humanFields(w, obj, indent+"  "); e != nil {
						return e
					}
					if _, e := fmt.Fprintln(w); e != nil {
						return e
					}
				} else {
					if _, e := fmt.Fprintf(w, "%s  - %s\n", indent, terminal(fmt.Sprint(item))); e != nil {
						return e
					}
				}
			}
		default:
			if _, e := fmt.Fprintf(w, "%s%s: %s\n", indent, terminal(k), terminal(fmt.Sprint(v))); e != nil {
				return e
			}
		}
	}
	return nil
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	os.Exit(newApp(os.Stdout, os.Stderr).run(ctx, os.Args[1:]))
}
