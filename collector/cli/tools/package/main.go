// Package builds standalone binaries and local archives; it never publishes.
package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"
)

type asset struct {
	name string
	data []byte
	mode int64
}
type target struct{ os, arch string }

var targets = []target{{"windows", "amd64"}, {"darwin", "amd64"}, {"darwin", "arm64"}, {"linux", "amd64"}, {"linux", "arm64"}}

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	version := flag.String("version", "dev", "version embedded in executable and archive names")
	native := flag.Bool("native", false, "build only native binary at dist/lingnest[.exe]")
	flag.Parse()
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`).MatchString(*version) {
		return fmt.Errorf("version must be a safe filename component")
	}
	if _, e := os.Stat("go.mod"); e != nil {
		return fmt.Errorf("run from collector/cli")
	}
	if e := os.MkdirAll("dist", 0755); e != nil {
		return e
	}
	if *native {
		bin := filepath.Join("dist", binaryName(runtime.GOOS))
		if e := build(target{runtime.GOOS, runtime.GOARCH}, *version, bin); e != nil {
			return e
		}
		fmt.Println(bin)
		return nil
	}
	extras := []asset{}
	for _, file := range []string{"LICENSE", "README.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md"} {
		b, e := os.ReadFile(file)
		if e != nil {
			return e
		}
		extras = append(extras, asset{file, b, 0644})
	}
	// Read the skill without modifying it. Include every regular file, preserving hierarchy.
	skill := filepath.Clean("../../skills/lingnest-library")
	skillIncluded := false
	if info, e := os.Stat(skill); e == nil && info.IsDir() {
		if _, e := os.Stat(filepath.Join(skill, "SKILL.md")); e != nil {
			return fmt.Errorf("skill directory lacks SKILL.md: %w", e)
		}
		e = filepath.WalkDir(skill, func(path string, d fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if d.IsDir() {
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("skill symlink refused: %s", path)
			}
			info, e := d.Info()
			if e != nil {
				return e
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("non-regular skill file: %s", path)
			}
			b, e := os.ReadFile(path)
			if e != nil {
				return e
			}
			rel, e := filepath.Rel(skill, path)
			if e != nil {
				return e
			}
			extras = append(extras, asset{"skills/lingnest-library/" + filepath.ToSlash(rel), b, 0644})
			return nil
		})
		if e != nil {
			return e
		}
		skillIncluded = true
	} else if e != nil && !os.IsNotExist(e) {
		return e
	}
	// Distribute the actual dependency licenses for the pinned module versions.
	cmd := exec.Command("go", "list", "-m", "-json", "all")
	data, e := cmd.Output()
	if e != nil {
		return e
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	for decoder.More() {
		var m struct {
			Main      bool
			Path, Dir string
		}
		if e = decoder.Decode(&m); e != nil {
			return e
		}
		if m.Main {
			continue
		}
		for _, name := range []string{"LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"} {
			b, e := os.ReadFile(filepath.Join(m.Dir, name))
			if e == nil {
				extras = append(extras, asset{"licenses/" + strings.ReplaceAll(m.Path, "/", "_") + "/" + name, b, 0644})
				break
			}
		}
	}
	var checks []string
	var archiveNames []string
	for _, t := range targets {
		stem := "lingnest-" + *version + "-" + t.os + "-" + t.arch
		dir := filepath.Join("dist", stem)
		if e = os.MkdirAll(dir, 0755); e != nil {
			return e
		}
		bin := filepath.Join(dir, binaryName(t.os))
		if e = build(t, *version, bin); e != nil {
			return e
		}
		b, e := os.ReadFile(bin)
		if e != nil {
			return e
		}
		files := append([]asset{{binaryName(t.os), b, 0755}}, extras...)
		archive := stem + ".tar.gz"
		if t.os == "windows" {
			archive = stem + ".zip"
		}
		if e = writeArchive(filepath.Join("dist", archive), files, t.os == "windows"); e != nil {
			return e
		}
		checks = append(checks, checksum(b)+"  "+filepath.ToSlash(filepath.Join(stem, binaryName(t.os))))
		packed, e := os.ReadFile(filepath.Join("dist", archive))
		if e != nil {
			return e
		}
		checks = append(checks, checksum(packed)+"  "+archive)
		archiveNames = append(archiveNames, archive)
		if t.os == runtime.GOOS && t.arch == runtime.GOARCH {
			if e = os.WriteFile(filepath.Join("dist", binaryName(t.os)), b, 0755); e != nil {
				return e
			}
		}
		fmt.Println(filepath.Join("dist", archive))
	}
	sort.Strings(checks)
	if e = os.WriteFile("dist/SHA256SUMS", []byte(strings.Join(checks, "\n")+"\n"), 0644); e != nil {
		return e
	}
	manifest, _ := json.MarshalIndent(map[string]any{"schema_version": 1, "version": *version, "skill_included": skillIncluded, "archives": archiveNames, "built_at": time.Now().UTC().Format(time.RFC3339)}, "", "  ")
	if e = os.WriteFile("dist/manifest.json", append(manifest, '\n'), 0644); e != nil {
		return e
	}
	fmt.Printf("Skill included: %t; checksums: dist/SHA256SUMS\n", skillIncluded)
	return nil
}
func binaryName(goos string) string {
	if goos == "windows" {
		return "lingnest.exe"
	}
	return "lingnest"
}
func checksum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func build(t target, version, path string) error {
	cmd := exec.Command("go", "build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -X main.version="+version, "-o", path, ".")
	// Filter rather than duplicate inherited cross-compilation settings (especially on Windows).
	for _, v := range os.Environ() {
		key, _, _ := strings.Cut(v, "=")
		if !strings.EqualFold(key, "GOOS") && !strings.EqualFold(key, "GOARCH") && !strings.EqualFold(key, "CGO_ENABLED") {
			cmd.Env = append(cmd.Env, v)
		}
	}
	cmd.Env = append(cmd.Env, "GOOS="+t.os, "GOARCH="+t.arch, "CGO_ENABLED=0")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if e := cmd.Run(); e != nil {
		return fmt.Errorf("build %s/%s: %w", t.os, t.arch, e)
	}
	return nil
}
func writeArchive(path string, files []asset, isZip bool) (err error) {
	sort.Slice(files, func(i, j int) bool { return files[i].name < files[j].name })
	f, e := os.Create(path)
	if e != nil {
		return e
	}
	defer func() {
		if e := f.Close(); err == nil {
			err = e
		}
	}()
	stamp := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	if isZip {
		z := zip.NewWriter(f)
		for _, a := range files {
			h := &zip.FileHeader{Name: a.name, Method: zip.Deflate}
			h.SetMode(fs.FileMode(a.mode))
			h.SetModTime(stamp)
			w, e := z.CreateHeader(h)
			if e != nil {
				return e
			}
			if _, e = w.Write(a.data); e != nil {
				return e
			}
		}
		return z.Close()
	}
	gz := gzip.NewWriter(f)
	tr := tar.NewWriter(gz)
	for _, a := range files {
		if e = tr.WriteHeader(&tar.Header{Name: a.name, Mode: a.mode, Size: int64(len(a.data)), ModTime: stamp, Typeflag: tar.TypeReg}); e != nil {
			return e
		}
		if _, e = tr.Write(a.data); e != nil {
			return e
		}
	}
	if e = tr.Close(); e != nil {
		return e
	}
	return gz.Close()
}
