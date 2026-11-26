//go:build lima

// Runs the real installer against a Lima VM (limactl start --name
// tiny-ssh-test template://ubuntu-lts). HOME is a temporary folder, so the
// user's kubeconfig, known_hosts and tiny profiles are never touched.
//
//	go test -tags lima -run TestInstallOnLima -v -timeout 30m .
package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

func TestInstallOnLima(t *testing.T) {
	realHome, _ := os.UserHomeDir()
	key := filepath.Join(realHome, ".lima", "_config", "user")
	out, err := exec.Command("limactl", "show-ssh", "--format", "options", "tiny-ssh-test").Output()
	if err != nil {
		t.Skipf("no Lima VM tiny-ssh-test: %v", err)
	}
	port := regexp.MustCompile(`Port=(\d+)`).FindStringSubmatch(string(out))
	user := regexp.MustCompile(`User=(\S+)`).FindStringSubmatch(string(out))
	if port == nil || user == nil {
		t.Fatalf("can't read Lima ssh options: %s", out)
	}
	p, _ := strconv.Atoi(port[1])

	home := t.TempDir()
	t.Setenv("HOME", home)
	// clientcmd fixes ~/.kube/config at package init, before HOME moves;
	// point it at the throwaway file explicitly.
	t.Setenv("KUBECONFIG", filepath.Join(home, ".kube", "config"))
	t.Setenv("SSH_AUTH_SOCK", "")

	a := NewApp()
	a.ctx = context.Background()
	var events []InstallEvent
	emit := func(e InstallEvent) {
		events = append(events, e)
		t.Logf("[%s/%s] %s", e.Step, e.Level, e.Text)
	}
	req := InstallRequest{Name: "lima-test", Host: "127.0.0.1", Port: p, User: strings.Trim(user[1], `"`), KeyFile: key, Namespace: "tiny", GVisor: true}

	// First attempt: an unknown host key must stop and show its fingerprint.
	_, err = a.install(context.Background(), req, emit)
	var uh UnknownHostError
	if !asUnknownHost(err, &uh) {
		t.Fatalf("want an unknown-host stop first, got %v", err)
	}
	req.TrustFingerprint = uh.Fingerprint

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()
	target, err := a.install(ctx, req, emit)
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(home, ".ssh", "known_hosts")); !strings.Contains(string(b), "[127.0.0.1]:"+port[1]) {
		t.Fatal("the trusted host key wasn't saved to known_hosts")
	}

	// The new fleet answers, and tiny's runtime is in it.
	c, err := fleet.Connect(target.Context, target.Namespace)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Load(ctx); err != nil {
		t.Fatalf("load the new fleet: %v", err)
	}
	// Running again keeps k3s and finds gVisor already registered.
	if _, err := a.install(ctx, req, emit); err != nil {
		t.Fatalf("second install: %v", err)
	}
}

func asUnknownHost(err error, uh *UnknownHostError) bool {
	for e := err; e != nil; {
		if u, ok := e.(UnknownHostError); ok {
			*uh = u
			return true
		}
		type unwrapper interface{ Unwrap() error }
		w, ok := e.(unwrapper)
		if !ok {
			return false
		}
		e = w.Unwrap()
	}
	return false
}
