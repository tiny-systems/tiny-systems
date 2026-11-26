package main

import (
	"testing"

	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestKernelBefore(t *testing.T) {
	for k, want := range map[string]bool{"5.4.0-216-generic": true, "5.10.0": false, "6.8.0-45": false, "4.19.0": true, "garbage": false} {
		if got := kernelBefore(k, 5, 10); got != want {
			t.Errorf("kernelBefore(%q) = %v", k, got)
		}
	}
}

// A kubeconfig from the remote machine is reduced to certificates: no
// credential programs, proxies or skipped TLS checks come along, and the
// server address is ours.
func TestSafeK3sEntries(t *testing.T) {
	good := func() *clientcmdapi.Config {
		c := clientcmdapi.NewConfig()
		c.Clusters["default"] = &clientcmdapi.Cluster{Server: "https://evil.example:6443", CertificateAuthorityData: []byte("ca"),
			InsecureSkipTLSVerify: true, ProxyURL: "http://attacker:8080"}
		c.AuthInfos["default"] = &clientcmdapi.AuthInfo{ClientCertificateData: []byte("crt"), ClientKeyData: []byte("key"),
			Username: "u", Password: "p", TokenFile: "/etc/shadow"}
		return c
	}
	cl, u, err := safeK3sEntries(good(), "192.168.1.20")
	if err != nil {
		t.Fatal(err)
	}
	if cl.Server != "https://192.168.1.20:6443" || cl.InsecureSkipTLSVerify || cl.ProxyURL != "" || string(cl.CertificateAuthorityData) != "ca" {
		t.Fatalf("cluster %+v", cl)
	}
	if u.Username != "" || u.Password != "" || u.TokenFile != "" || string(u.ClientCertificateData) != "crt" {
		t.Fatalf("user %+v", u)
	}
	if cl, _, _ := safeK3sEntries(good(), "fe80::1"); cl.Server != "https://[fe80::1]:6443" {
		t.Fatalf("ipv6 server %s", cl.Server)
	}

	withExec := good()
	withExec.AuthInfos["default"].Exec = &clientcmdapi.ExecConfig{Command: "/bin/sh"}
	if _, _, err := safeK3sEntries(withExec, "h"); err == nil {
		t.Fatal("an exec credential plugin must be refused")
	}
	noCA := good()
	noCA.Clusters["default"].CertificateAuthorityData = nil
	if _, _, err := safeK3sEntries(noCA, "h"); err == nil {
		t.Fatal("a cluster without a CA must be refused")
	}
}

func TestShellQuote(t *testing.T) {
	if got := shellQuote(`it's`); got != `'it'\''s'` {
		t.Fatal(got)
	}
}
