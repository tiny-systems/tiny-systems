package main

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

// webDemo is what the web build of the app (the one on tinysystems.io)
// serves instead of a backend: the same demo garden TINY_DEMO=1 shows, so
// the page and the app never drift apart.
type webDemo struct {
	Targets       []Target             `json:"targets"`
	Fleet         Fleet                `json:"fleet"`
	Gardens       []Garden             `json:"gardens"`
	Health        fleet.Health         `json:"health"`
	Conversations map[string][]Message `json:"conversations"`
	Shown         map[string]ShownFile `json:"shown"`
}

func buildWebDemo() webDemo {
	a := &App{}
	f := demoFleet()
	d := webDemo{
		Targets:       []Target{demoTarget()},
		Fleet:         f,
		Gardens:       []Garden{{Target: demoTarget(), Where: "This Mac", Local: true, VMStatus: "Running"}},
		Conversations: map[string][]Message{},
		Shown:         map[string]ShownFile{},
	}
	d.Shown[demoChart], _ = demoShown(demoChart)
	d.Health, _ = a.Health(demoTarget())
	for _, r := range f.Rows {
		d.Conversations[r.Name] = demoConversation(r.Name)
	}
	return d
}

// TestWebDemoData writes the demo data for the web build when asked:
//
//	WEB_DEMO_OUT=frontend/web/demo.json go test -run TestWebDemoData .
func TestWebDemoData(t *testing.T) {
	d := buildWebDemo()
	if len(d.Fleet.Rows) == 0 || len(d.Conversations["s-fern"]) == 0 {
		t.Fatal("demo garden is empty")
	}
	out := os.Getenv("WEB_DEMO_OUT")
	if out == "" {
		return
	}
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, append(b, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}
