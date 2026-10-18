package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/url"
	"os"
	"strings"
)

func digest(s string) bool { b, e := hex.DecodeString(s); return e == nil && len(b) == sha256.Size }
func (a *app) download(ctx context.Context, c *client, o options) (map[string]any, error) {
	// Early check improves UX; O_EXCL below is the authoritative no-overwrite check.
	if _, e := os.Lstat(o.output); e == nil {
		return nil, fail(exitLocal, "file_exists", "output already exists; refusing overwrite")
	} else if !os.IsNotExist(e) {
		return nil, fail(exitLocal, "output_failed", "cannot inspect output path")
	}
	id, file := o.args[0], o.query.Get("file")
	meta, e := c.get(ctx, "entry", url.Values{"id": {id}})
	if e != nil {
		return nil, e
	}
	if stringField(meta, "id") != id {
		return nil, fail(exitIntegrity, "metadata_mismatch", "entry metadata ID does not match request")
	}
	files, _ := meta["files"].([]any)
	var wanted map[string]any
	for _, v := range files {
		f, _ := v.(map[string]any)
		if stringField(f, "path") == file {
			if wanted != nil {
				return nil, fail(exitIntegrity, "metadata_mismatch", "duplicate file metadata")
			}
			wanted = f
		}
	}
	if wanted == nil {
		return nil, fail(exitIntegrity, "file_not_listed", "requested file is absent from trusted entry metadata")
	}
	expected := strings.ToLower(stringField(wanted, "sha256"))
	size, ok := wanted["bytes"].(float64)
	if !digest(expected) || !ok || size < 0 || size != float64(int64(size)) {
		return nil, fail(exitIntegrity, "invalid_file_metadata", "file requires a valid SHA256 and byte length")
	}
	if size > maxFile {
		return nil, fail(exitIntegrity, "file_too_large", "download exceeds 16 MiB limit")
	}
	r, e := c.request(ctx, "GET", "/api/read/v1/file", url.Values{"id": {id}, "file": {file}}, nil, "")
	if e != nil {
		return nil, e
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		b, e := readBounded(r.Body, maxFile)
		if e != nil {
			return nil, e
		}
		return nil, apiError(r.StatusCode, b)
	}
	header := strings.ToLower(r.Header.Get("X-Content-SHA256"))
	if !digest(header) || header != expected {
		return nil, fail(exitIntegrity, "checksum_mismatch", "response SHA256 does not match entry metadata")
	}
	if r.ContentLength > maxFile {
		return nil, fail(exitIntegrity, "file_too_large", "download exceeds 16 MiB limit")
	}
	b, e := readBounded(r.Body, maxFile)
	if e != nil {
		return nil, e
	}
	actual := sha256.Sum256(b)
	if hex.EncodeToString(actual[:]) != expected || int64(len(b)) != int64(size) {
		return nil, fail(exitIntegrity, "checksum_mismatch", "download bytes do not match trusted SHA256 and size")
	}
	// Verify entirely before creating the destination. Exclusive creation also refuses symlinks.
	f, e := os.OpenFile(o.output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return nil, fail(exitLocal, "output_failed", "cannot create output exclusively; it may already exist")
	}
	n, e := f.Write(b)
	if e == nil && n != len(b) {
		e = io.ErrShortWrite
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil || closeErr != nil {
		_ = os.Remove(o.output)
		return nil, fail(exitLocal, "output_failed", "cannot write complete download")
	}
	return map[string]any{"schema_version": 1, "id": id, "file": file, "output": o.output, "bytes": len(b), "sha256": expected}, nil
}
