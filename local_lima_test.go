//go:build lima

package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// The "This Mac" path end to end: a Lima VM created by the app's code,
// set up as a fleet, its health read, then stopped and started again.
// HOME is temporary; LIMA_HOME stays the real one so the Ubuntu image is
// reused. Deletes its VM at the end.
//
//	go test -count=1 -tags lima -run TestInstallLocal -v -timeout 40m .
func TestInstallLocal(t *testing.T) {
	bin, err := limactl()
	if err != nil {
		t.Skip(err)
	}
	realHome, _ := os.UserHomeDir()
	t.Setenv("LIMA_HOME", filepath.Join(realHome, ".lima"))
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("KUBECONFIG", filepath.Join(home, ".kube", "config"))
	t.Setenv("SSH_AUTH_SOCK", "")
	t.Cleanup(func() { _ = exec.Command(bin, "delete", "-f", vmPrefix+"e2e").Run() })

	a := NewApp()
	a.ctx = context.Background()
	emit := func(e InstallEvent) {
		if e.Level != "log" {
			t.Logf("[%s/%s] %s", e.Step, e.Level, e.Text)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Minute)
	defer cancel()
	target, err := a.installLocal(ctx, bin, LocalInstallRequest{Name: "e2e", CPUs: 2, MemoryGB: 4, DiskGB: 30, GVisor: true}, emit)
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	h, err := a.Health(*target)
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	t.Logf("health: %+v", h)
	if len(h.Nodes) != 1 || !h.Nodes[0].Ready || len(h.RuntimeMissing) != 0 || h.SignIn != "none" {
		t.Fatalf("unexpected health %+v", h)
	}
	if h.Nodes[0].DiskTotalGB <= 0 {
		t.Error("node disk should be readable on a cluster we installed")
	}

	if err := a.StopVM("e2e"); err != nil {
		t.Fatal(err)
	}
	if st := a.Local(); !vmIs(st, "e2e", "Stopped") {
		t.Fatalf("after stop: %+v", st)
	}
	if err := a.StartVM("e2e"); err != nil {
		t.Fatal(err)
	}
	if st := a.Local(); !vmIs(st, "e2e", "Running") {
		t.Fatalf("after start: %+v", st)
	}
}

func vmIs(st LocalStatus, name, status string) bool {
	for _, v := range st.VMs {
		if v.Name == name {
			return v.Status == status
		}
	}
	return false
}
