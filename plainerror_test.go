package main

import (
	"errors"
	"strings"
	"testing"
)

func TestPlainError(t *testing.T) {
	for raw, want := range map[string]string{
		"ssh: ssh: handshake failed: ssh: unable to authenticate, attempted methods [none publickey]": "SSH key",
		"ssh: dial tcp 10.0.0.5:22: connect: connection refused":                                      "Nothing answered",
		"ssh: dial tcp: lookup nas.local: no such host":                                               "no computer with that name",
		"ssh: dial tcp 10.0.0.5:22: i/o timeout":                                                      "Couldn't reach",
		"sudo refused: Process exited with status 1":                                                  "sudo password",
		"write /var/lib/rancher: no space left on device":                                             "disk space",
	} {
		if got := plainError(errors.New(raw)); !strings.Contains(got, want) {
			t.Fatalf("%q: got %q", raw, got)
		}
	}
	if got := plainError(errors.New("something new")); got != "something new" {
		t.Fatalf("unknown errors pass through, got %q", got)
	}
}
