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
		{Name: "s-sorrel", Parent: "s-basil", Depth: 1, Phase: "Running", Glyph: "●", Title: "Checking every link in the welcome email", Activity: "Opening the getting-started guide link", Age: "6m", Attach: true},
		{Name: "s-fern", Phase: "Running", Glyph: "✳", Title: "Fixing the checkout test that fails on Mondays", Age: "40m", Attach: true,
			Question: &Asking{Name: "q-fern", Session: "s-fern", Text: "The test depends on the local time zone. Should I pin it to UTC, or make the test run in every time zone?", Options: []string{"Pin to UTC", "Every time zone"}}},
		{Name: "s-rue", Phase: "Running", Glyph: "✳", Title: "Building the new pricing page", Age: "25m", Attach: true,
			Question: &Asking{Name: "q-rue", Session: "s-rue", Text: demoRueAsk, Options: []string{"allow", "deny"},
				Action: &Action{Type: "exposePort", Params: map[string]string{"port": "5173", "name": "pricing-preview"}}}},
		{Name: "s-mint", Phase: "Done", Glyph: "✓", Title: "Added a dark mode to the settings page", Age: "2h", Exit: &exit0},
		{Name: "s-sage", Phase: "Running", Glyph: "⏸", Title: "Translating the help pages into Spanish", Age: "1d", Paused: true},
		{Name: "s-ivy", Phase: "Failed", Glyph: "✗", Title: "Updating the payment library", Message: "It couldn't download the new version: the website it needs isn't on this garden's list of allowed sites.", Age: "3h"},
		{Name: "s-moss", Phase: "starting", Glyph: "◌", Title: "Summarising last week's support tickets", Age: "20s"},
	}
	return Fleet{Target: demoTarget(), Rows: rows, ReadAt: time.Now().Format("15:04:05"), NeedsYou: 2, Running: 4}
}

const demoRueAsk = "Can I open port 5173 so you can look at the page in your browser?"

// DemoSelect is the helper the demo opens with, if any.
func (a *App) DemoSelect() string { return strings.TrimSpace(os.Getenv("TINY_DEMO_SELECT")) }

func demoConversation(session string) []Message {
	now := time.Now().UTC()
	at := func(d time.Duration) string { return now.Add(-d).Format(time.RFC3339) }
	switch session {
	case "s-fern":
		return []Message{
			{From: "you", Text: "Fix the checkout test that fails on Mondays", At: at(40 * time.Minute)},
			{From: "helper", Text: "Found it: the test builds a date from the local clock and assumes a weekday. On Mondays the 'previous business day' wraps to Friday and the expected total is off by one.", At: at(31 * time.Minute)},
			{From: "helper", File: demoChart, Text: "A month of runs by weekday: every Monday run fails, every other day passes.", At: at(29 * time.Minute)},
			{From: "helper", Question: "q-fern", Open: true, Options: []string{"Pin to UTC", "Every time zone"},
				Text: "The test depends on the local time zone. Should I pin it to UTC, or make the test run in every time zone?", At: at(6 * time.Minute)},
		}
	case "s-rue":
		return []Message{
			{From: "you", Text: "Build the new pricing page from the Figma notes in docs/pricing.md", At: at(25 * time.Minute)},
			{From: "helper", Text: "The page is up in the dev server with all three plans and the yearly toggle.", At: at(3 * time.Minute)},
			{From: "helper", Question: "q-rue", Open: true, Options: []string{"allow", "deny"}, Text: demoRueAsk, At: at(2 * time.Minute),
				Action: &Action{Type: "exposePort", Params: map[string]string{"port": "5173", "name": "pricing-preview"}}},
		}
	case "s-basil":
		return []Message{
			{From: "you", Text: "Write the welcome email for new customers. Friendly, short, and link the getting-started guide.", At: at(12 * time.Minute)},
			{From: "helper", Question: "q-b1", Text: "Should it come from the team or from you personally?", Options: []string{"From the team", "From me"}, Answer: "From the team", At: at(9 * time.Minute)},
			{From: "you", Text: "Mention the free onboarding call too.", At: at(4 * time.Minute)},
		}
	default:
		for _, r := range demoFleet().Rows {
			if r.Name == session {
				return []Message{{From: "you", Text: r.Title, At: at(time.Hour)}}
			}
		}
		return nil
	}
}
