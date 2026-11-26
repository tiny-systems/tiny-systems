package main

import (
	"os"
	"strings"
	"time"
)

// A demo garden with a helper in every state, for screenshots and design
// work: TINY_DEMO=1. It never talks to a cluster. TINY_DEMO_SELECT names
// the helper whose sheet opens at start.
const demoContext = "__demo__"

func demoOn() bool { return os.Getenv("TINY_DEMO") != "" }

func demoTarget() Target { return Target{Name: "garden", Context: demoContext, Namespace: "demo"} }

func isDemo(t Target) bool { return t.Context == demoContext }

func demoFleet() Fleet {
	exit0 := 0
	rows := []Row{
		{Name: "s-basil", Phase: "Running", Glyph: "●", Title: "Writing the welcome email for new customers", Activity: "Drafting the second paragraph, keeping it under 120 words", Age: "12m", Attach: true, CPU: "210m", Mem: "380Mi"},
		{Name: "s-fern", Phase: "Running", Glyph: "✳", Title: "Fixing the checkout test that fails on Mondays", Age: "40m", Attach: true,
			Question: &Asking{Name: "q-fern", Session: "s-fern", Text: "The test depends on the local time zone. Should I pin it to UTC, or make the test run in every time zone?", Options: []string{"Pin to UTC", "Every time zone"}}},
		{Name: "s-mint", Phase: "Done", Glyph: "✓", Title: "Added a dark mode to the settings page", Age: "2h", Exit: &exit0},
		{Name: "s-sage", Phase: "Running", Glyph: "⏸", Title: "Translating the help pages into Spanish", Age: "1d", Paused: true},
		{Name: "s-ivy", Phase: "Failed", Glyph: "✗", Title: "Updating the payment library", Message: "It couldn't download the new version: the website it needs isn't on this garden's list of allowed sites.", Age: "3h"},
		{Name: "s-moss", Phase: "starting", Glyph: "◌", Title: "Summarising last week's support tickets", Age: "20s"},
	}
	return Fleet{Target: demoTarget(), Rows: rows, ReadAt: time.Now().Format("15:04:05"), NeedsYou: 1, Running: 2}
}

// DemoSelect is the helper the demo opens with, if any.
func (a *App) DemoSelect() string { return strings.TrimSpace(os.Getenv("TINY_DEMO_SELECT")) }
