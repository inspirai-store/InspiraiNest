package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestArchiveContentsAndExecutableMode(t *testing.T) {
	files := []asset{{"lingnest", []byte("executable fixture"), 0755}, {"skills/lingnest-library/SKILL.md", []byte("# Fixture skill\n"), 0644}}
	for _, isZip := range []bool{false, true} {
		name := "tar"
		if isZip {
			name = "zip"
		}
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "archive")
			if e := writeArchive(path, files, isZip); e != nil {
				t.Fatal(e)
			}
			got := map[string][]byte{}
			modes := map[string]int64{}
			if isZip {
				r, e := zip.OpenReader(path)
				if e != nil {
					t.Fatal(e)
				}
				defer r.Close()
				for _, f := range r.File {
					reader, e := f.Open()
					if e != nil {
						t.Fatal(e)
					}
					b, e := io.ReadAll(reader)
					reader.Close()
					if e != nil {
						t.Fatal(e)
					}
					got[f.Name] = b
					modes[f.Name] = int64(f.Mode().Perm())
				}
			} else {
				f, e := os.Open(path)
				if e != nil {
					t.Fatal(e)
				}
				defer f.Close()
				gz, e := gzip.NewReader(f)
				if e != nil {
					t.Fatal(e)
				}
				defer gz.Close()
				tr := tar.NewReader(gz)
				for {
					h, e := tr.Next()
					if e == io.EOF {
						break
					}
					if e != nil {
						t.Fatal(e)
					}
					b, e := io.ReadAll(tr)
					if e != nil {
						t.Fatal(e)
					}
					got[h.Name] = b
					modes[h.Name] = h.Mode
				}
			}
			for _, a := range files {
				if !bytes.Equal(got[a.name], a.data) || modes[a.name] != a.mode {
					t.Fatalf("archive corrupt or wrong mode: %s", a.name)
				}
			}
		})
	}
}
