package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// tempHome points HOME at an empty folder, so tests never touch the real
// known_hosts, kubeconfig or tiny config.
func tempHome(t *testing.T) string {
	t.Helper()
	h := t.TempDir()
	t.Setenv("HOME", h)
	return h
}

func hostKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	k, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func TestHostKeyUnknownIsRefusedWithFingerprint(t *testing.T) {
	home := tempHome(t)
	cb, err := hostKeyCallback("")
	if err != nil {
		t.Fatal(err)
	}
	key := hostKey(t)
	err = cb("box:22", &net.TCPAddr{IP: net.IPv4(10, 0, 0, 5), Port: 22}, key)
	var uh UnknownHostError
	if !errors.As(err, &uh) {
		t.Fatalf("want UnknownHostError, got %v", err)
	}
	if uh.Fingerprint != ssh.FingerprintSHA256(key) {
		t.Fatalf("fingerprint %q, want %q", uh.Fingerprint, ssh.FingerprintSHA256(key))
	}
	// known_hosts is created private and left empty.
	st, err := os.Stat(filepath.Join(home, ".ssh", "known_hosts"))
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 || st.Size() != 0 {
		t.Fatalf("known_hosts mode %v size %d, want 0600 and empty", st.Mode().Perm(), st.Size())
	}
}

func TestHostKeyConfirmedIsSavedThenTrusted(t *testing.T) {
	tempHome(t)
	key := hostKey(t)
	addr := &net.TCPAddr{IP: net.IPv4(10, 0, 0, 5), Port: 22}
	cb, err := hostKeyCallback(ssh.FingerprintSHA256(key))
	if err != nil {
		t.Fatal(err)
	}
	if err := cb("box:22", addr, key); err != nil {
		t.Fatalf("confirmed key refused: %v", err)
	}
	// A new connection that confirmed nothing now trusts it.
	cb, err = hostKeyCallback("")
	if err != nil {
		t.Fatal(err)
	}
	if err := cb("box:22", addr, key); err != nil {
		t.Fatalf("saved key refused: %v", err)
	}
}

func TestHostKeyWrongConfirmationIsRefused(t *testing.T) {
	tempHome(t)
	cb, err := hostKeyCallback(ssh.FingerprintSHA256(hostKey(t)))
	if err != nil {
		t.Fatal(err)
	}
	var uh UnknownHostError
	if err := cb("box:22", &net.TCPAddr{IP: net.IPv4(10, 0, 0, 5), Port: 22}, hostKey(t)); !errors.As(err, &uh) {
		t.Fatalf("a different key than the one confirmed must be refused, got %v", err)
	}
}

func TestHostKeyChangedIsAlwaysRefused(t *testing.T) {
	tempHome(t)
	addr := &net.TCPAddr{IP: net.IPv4(10, 0, 0, 5), Port: 22}
	old := hostKey(t)
	cb, _ := hostKeyCallback(ssh.FingerprintSHA256(old))
	if err := cb("box:22", addr, old); err != nil {
		t.Fatal(err)
	}
	evil := hostKey(t)
	// Even "confirming" the new fingerprint must not replace a saved key.
	cb, _ = hostKeyCallback(ssh.FingerprintSHA256(evil))
	err := cb("box:22", addr, evil)
	if err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("changed host key must be refused, got %v", err)
	}
}

func k3sConfig(t *testing.T, mutate func(*clientcmdapi.Config)) []byte {
	t.Helper()
	c := clientcmdapi.NewConfig()
	c.Clusters["default"] = &clientcmdapi.Cluster{Server: "https://127.0.0.1:6443", CertificateAuthorityData: []byte("CA")}
	c.AuthInfos["default"] = &clientcmdapi.AuthInfo{ClientCertificateData: []byte("CERT"), ClientKeyData: []byte("KEY")}
	c.Contexts["default"] = &clientcmdapi.Context{Cluster: "default", AuthInfo: "default"}
	c.CurrentContext = "default"
	if mutate != nil {
		mutate(c)
	}
	b, err := clientcmd.Write(*c)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestMergeKubeconfigFreshHome(t *testing.T) {
	home := tempHome(t)
	path, backup, err := mergeKubeconfig(k3sConfig(t, nil), "basil", "10.0.0.5", 6443)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(home, ".kube", "config") || backup != "" {
		t.Fatalf("path %q backup %q", path, backup)
	}
	st, _ := os.Stat(path)
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("kubeconfig mode %v, want 0600", st.Mode().Perm())
	}
	got, err := clientcmd.LoadFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if s := got.Clusters["basil"].Server; s != "https://10.0.0.5:6443" {
		t.Fatalf("server %q: must point at the machine, not 127.0.0.1", s)
	}
	if got.Contexts["basil"] == nil || got.AuthInfos["basil"] == nil {
		t.Fatal("context or user missing")
	}
}

func TestMergeKubeconfigKeepsExistingAndBacksUp(t *testing.T) {
	home := tempHome(t)
	path := filepath.Join(home, ".kube", "config")
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	prev := clientcmdapi.NewConfig()
	prev.Clusters["work"] = &clientcmdapi.Cluster{Server: "https://work:443"}
	prev.AuthInfos["work"] = &clientcmdapi.AuthInfo{Token: "t"}
	prev.Contexts["work"] = &clientcmdapi.Context{Cluster: "work", AuthInfo: "work"}
	prev.CurrentContext = "work"
	if err := clientcmd.WriteToFile(*prev, path); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)

	_, backup, err := mergeKubeconfig(k3sConfig(t, nil), "basil", "10.0.0.5", 6443)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(backup); string(b) != string(before) {
		t.Fatal("backup doesn't hold the previous kubeconfig")
	}
	got, _ := clientcmd.LoadFromFile(path)
	if got.Contexts["work"] == nil || got.CurrentContext != "work" {
		t.Fatal("existing context or current-context lost")
	}
	if got.Contexts["basil"] == nil {
		t.Fatal("new context missing")
	}
}

func TestMergeKubeconfigNameClash(t *testing.T) {
	tempHome(t)
	if _, _, err := mergeKubeconfig(k3sConfig(t, nil), "basil", "10.0.0.5", 6443); err != nil {
		t.Fatal(err)
	}
	// Same machine again: fine, nothing changes.
	if _, backup, err := mergeKubeconfig(k3sConfig(t, nil), "basil", "10.0.0.5", 6443); err != nil || backup != "" {
		t.Fatalf("re-adding the same machine: backup %q err %v", backup, err)
	}
	// A different machine under the same name: refused, not overwritten.
	if _, _, err := mergeKubeconfig(k3sConfig(t, nil), "basil", "10.0.0.9", 6443); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("want name clash error, got %v", err)
	}
}

func TestMergeKubeconfigDropsDangerousFields(t *testing.T) {
	tempHome(t)
	b := k3sConfig(t, func(c *clientcmdapi.Config) {
		c.Clusters["default"].InsecureSkipTLSVerify = true
		c.Clusters["default"].ProxyURL = "http://evil:3128"
	})
	path, _, err := mergeKubeconfig(b, "basil", "10.0.0.5", 6443)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := clientcmd.LoadFromFile(path)
	c := got.Clusters["basil"]
	if c.InsecureSkipTLSVerify || c.ProxyURL != "" {
		t.Fatalf("copied unsafe cluster fields: insecure=%v proxy=%q", c.InsecureSkipTLSVerify, c.ProxyURL)
	}
	for _, bad := range []func(*clientcmdapi.Config){
		func(c *clientcmdapi.Config) {
			c.AuthInfos["default"].Exec = &clientcmdapi.ExecConfig{Command: "/bin/sh", APIVersion: "client.authentication.k8s.io/v1"}
		},
		func(c *clientcmdapi.Config) { c.Clusters["default"].CertificateAuthorityData = nil },
	} {
		if _, _, err := mergeKubeconfig(k3sConfig(t, bad), "other", "10.0.0.6", 6443); err == nil {
			t.Fatal("unsafe k3s kubeconfig was accepted")
		}
	}
}

func tinyConfig(t *testing.T) string {
	t.Helper()
	dir, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "tiny", "config.json")
}

func TestSaveProfileFresh(t *testing.T) {
	tempHome(t)
	if err := saveProfile(Target{Name: "basil", Context: "basil", Namespace: "agents"}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(tinyConfig(t))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Context, Namespace string
		Profiles           map[string]map[string]string
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Context != "basil" || doc.Namespace != "agents" || doc.Profiles["basil"]["namespace"] != "agents" {
		t.Fatalf("got %+v", doc)
	}
}

func TestSaveProfileKeepsOtherFields(t *testing.T) {
	tempHome(t)
	path := tinyConfig(t)
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	_ = os.WriteFile(path, []byte(`{"context":"work","namespace":"team","theme":"dark","profiles":{"work":{"context":"work","namespace":"team"}}}`), 0o600)
	if err := saveProfile(Target{Name: "basil", Context: "basil", Namespace: "agents"}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	var doc map[string]any
	_ = json.Unmarshal(b, &doc)
	if doc["context"] != "work" || doc["theme"] != "dark" {
		t.Fatalf("pinned target or unknown field changed: %v", doc)
	}
	p := doc["profiles"].(map[string]any)
	if p["work"] == nil || p["basil"] == nil {
		t.Fatalf("profiles: %v", p)
	}
}

func TestSaveProfileRefusesBrokenConfig(t *testing.T) {
	tempHome(t)
	path := tinyConfig(t)
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	_ = os.WriteFile(path, []byte(`{not json`), 0o600)
	if err := saveProfile(Target{Name: "basil", Context: "basil", Namespace: "agents"}); err == nil {
		t.Fatal("broken config was overwritten")
	}
	if b, _ := os.ReadFile(path); string(b) != `{not json` {
		t.Fatal("broken config was touched")
	}
}

func TestSmallHelpers(t *testing.T) {
	home := tempHome(t)
	if got := expandHome("~/.ssh/id"); got != filepath.Join(home, ".ssh/id") {
		t.Fatalf("expandHome: %q", got)
	}
	if got := expandHome("/abs/~/x"); got != "/abs/~/x" {
		t.Fatalf("expandHome touched an absolute path: %q", got)
	}
	if got := lastLines("a\nb\nc\nd", 2); got != "c / d" {
		t.Fatalf("lastLines: %q", got)
	}
	if apiPort(InstallRequest{}) != 6443 || apiPort(InstallRequest{APIPort: 16443}) != 16443 {
		t.Fatal("apiPort")
	}
}
