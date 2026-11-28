//go:build live

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestShipFolderLive starts a helper from a local folder on a real garden
// and checks the files arrive. LIVE_CONTEXT and LIVE_NAMESPACE name it.
//
//	LIVE_CONTEXT=garden2 LIVE_NAMESPACE=tiny go test -tags live -run TestShipFolderLive -v .
func TestShipFolderLive(t *testing.T) {
	ctxName, ns := os.Getenv("LIVE_CONTEXT"), os.Getenv("LIVE_NAMESPACE")
	if ctxName == "" {
		t.Skip("LIVE_CONTEXT not set")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("from the mac\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	done := make(chan string, 1)
	a := NewApp()
	a.ctx = ctx
	a.emitTo = func(name string, data ...any) {
		if name == "ship:done" || name == "ship:failed" {
			done <- name + " " + toString(data)
		}
	}
	tg := Target{Context: ctxName, Namespace: ns}
	name, err := a.NewSession(tg, NewSessionRequest{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Delete(tg, name) }()
	select {
	case got := <-done:
		if !strings.HasPrefix(got, "ship:done") {
			t.Fatalf("ship: %s", got)
		}
	case <-ctx.Done():
		t.Fatal("timed out")
	}
	store, row, err := a.findRow(tg, name)
	if err != nil {
		t.Fatal(err)
	}
	b, err := store.ReadFile(ctx, row.Pod, "/workspace/repo/hello.txt", 1<<10)
	if err != nil || string(b) != "from the mac\n" {
		t.Fatalf("hello.txt = %q, %v", b, err)
	}
}

func toString(data []any) string { return fmt.Sprint(data...) }
