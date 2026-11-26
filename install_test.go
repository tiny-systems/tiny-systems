package main

import "testing"

func TestKernelBefore(t *testing.T) {
	for k, want := range map[string]bool{"5.4.0-216-generic": true, "5.10.0": false, "6.8.0-45": false, "4.19.0": true, "garbage": false} {
		if got := kernelBefore(k, 5, 10); got != want {
			t.Errorf("kernelBefore(%q) = %v", k, got)
		}
	}
}

func TestRewriteServer(t *testing.T) {
	if got := rewriteServer("https://127.0.0.1:6443", "192.168.1.20"); got != "https://192.168.1.20:6443" {
		t.Fatal(got)
	}
}

func TestShellQuote(t *testing.T) {
	if got := shellQuote(`it's`); got != `'it'\''s'` {
		t.Fatal(got)
	}
}
