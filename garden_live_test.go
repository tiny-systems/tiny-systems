//go:build live

package main

import (
	"context"
	"os"
	"slices"
	"testing"
)

// TestGardenSettingsLive reads a real garden's settings and, when its
// allow-list is on, adds and removes a harmless host.
//
//	LIVE_CONTEXT=garden2 LIVE_NAMESPACE=tiny go test -tags live -run TestGardenSettingsLive -v .
func TestGardenSettingsLive(t *testing.T) {
	ctxName, ns := os.Getenv("LIVE_CONTEXT"), os.Getenv("LIVE_NAMESPACE")
	if ctxName == "" {
		t.Skip("LIVE_CONTEXT not set")
	}
	a := NewApp()
	a.ctx = context.Background()
	tg := Target{Name: "live", Context: ctxName, Namespace: ns}
	gs, err := a.GardenSettings(tg)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("egress %s (%s, proxy %q), %d hosts, %d refused; sign-in %s %s", gs.Egress.Mode, gs.Egress.Enforced, gs.Egress.Proxy, len(gs.Egress.Hosts), len(gs.Refused), gs.Model.Mode, gs.Model.Kind)
	for _, r := range gs.Refused {
		t.Logf("  refused %s ×%d last %s lookup=%v", r.Host, r.Count, r.Last.Format("15:04"), r.Lookup)
	}
	if gs.Egress.Mode != "allowlist" {
		return
	}
	const probe = "tiny-live-check.example.org"
	if err := a.AllowHost(tg, probe); err != nil {
		t.Fatal(err)
	}
	gs, _ = a.GardenSettings(tg)
	if !slices.Contains(gs.Egress.Hosts, probe) {
		t.Errorf("%s not listed after allow", probe)
	}
	if err := a.RemoveHost(tg, probe); err != nil {
		t.Fatal(err)
	}
	gs, _ = a.GardenSettings(tg)
	if slices.Contains(gs.Egress.Hosts, probe) {
		t.Errorf("%s still listed after remove", probe)
	}
}
