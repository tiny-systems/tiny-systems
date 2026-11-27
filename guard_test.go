package main

import "testing"

func TestGuardRecovers(t *testing.T) {
	var got error
	func() {
		defer guard("test", func(err error) { got = err })
		panic("boom")
	}()
	if got == nil || got.Error() != "test: panic: boom" {
		t.Fatalf("got %v", got)
	}
}
