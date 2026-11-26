//go:build lima

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"

	"golang.org/x/crypto/ssh/agent"
)

// TestDialWithUnrelatedAgent connects to a running Lima VM while an SSH
// agent offers only keys the VM doesn't know, as on any Mac where the app
// starts from Finder. The Lima key must still be offered.
//
//	LIMA_VM=tiny-homegarden go test -tags lima -run TestDialWithUnrelatedAgent -v .
func TestDialWithUnrelatedAgent(t *testing.T) {
	vm := os.Getenv("LIMA_VM")
	if vm == "" {
		t.Skip("set LIMA_VM to a running Lima VM")
	}
	out, err := exec.Command("limactl", "show-ssh", "--format", "options", vm).Output()
	if err != nil {
		t.Skipf("no Lima VM %s: %v", vm, err)
	}
	port := regexp.MustCompile(`Port=(\d+)`).FindStringSubmatch(string(out))
	user := regexp.MustCompile(`User=(\S+)`).FindStringSubmatch(string(out))
	p, _ := strconv.Atoi(port[1])

	key := filepath.Join(limaHome(), "_config", "user")
	keyring := agent.NewKeyring()
	for range 3 {
		_, priv, _ := ed25519.GenerateKey(rand.Reader)
		if err := keyring.Add(agent.AddedKey{PrivateKey: priv}); err != nil {
			t.Fatal(err)
		}
	}
	sock := filepath.Join(t.TempDir(), "agent.sock")
	l, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func() { _ = agent.ServeAgent(keyring, c); c.Close() }()
		}
	}()
	t.Setenv("SSH_AUTH_SOCK", sock)
	t.Setenv("HOME", t.TempDir()) // no ~/.ssh keys, fresh known_hosts

	req := InstallRequest{Host: "127.0.0.1", Port: p, User: user[1], KeyFile: key}
	r, err := dialRemote(req, func(string) {})
	var uh UnknownHostError
	if asUnknownHost(err, &uh) {
		req.TrustFingerprint = uh.Fingerprint
		r, err = dialRemote(req, func(string) {})
	}
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer r.client.Close()
}
