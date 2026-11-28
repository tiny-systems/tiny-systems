package main

import "strings"

// The demo garden's changes: Fern's Monday fix, so the Changes tab has
// something real-looking to show without a cluster.

var demoPatches = map[string]string{
	"checkout/total_test.go": `diff --git a/checkout/total_test.go b/checkout/total_test.go
index 4e1c2a0..9b7d3f1 100644
--- a/checkout/total_test.go
+++ b/checkout/total_test.go
@@ -12,9 +12,10 @@ import (
 func TestTotalIncludesPreviousBusinessDay(t *testing.T) {
-	now := time.Now()
+	// A fixed Monday: the case that used to fail.
+	now := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
 	cart := newCart(now)
 	cart.Add(item("coffee", 450))
-	if got, want := cart.Total(), 450; got != want {
+	if got, want := cart.Total(now), 450; got != want {
 		t.Fatalf("total = %d, want %d", got, want)
 	}
 }
`,
	"checkout/clock.go": `diff --git a/checkout/clock.go b/checkout/clock.go
index 1a2b3c4..5d6e7f8 100644
--- a/checkout/clock.go
+++ b/checkout/clock.go
@@ -3,12 +3,14 @@ package checkout
 import "time"

-// previousBusinessDay is yesterday, skipping the weekend.
-func previousBusinessDay() time.Time {
-	d := time.Now().AddDate(0, 0, -1)
-	for d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
+// previousBusinessDay is the working day before now, skipping the
+// weekend. It takes now so callers (and tests) pick the clock.
+func previousBusinessDay(now time.Time) time.Time {
+	d := now.AddDate(0, 0, -1)
+	for d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
 		d = d.AddDate(0, 0, -1)
 	}
-	return d
+	return d.Truncate(24 * time.Hour)
 }
`,
	"checkout/cart.go": `diff --git a/checkout/cart.go b/checkout/cart.go
index 7f8e9d0..0a1b2c3 100644
--- a/checkout/cart.go
+++ b/checkout/cart.go
@@ -40,7 +40,7 @@ func (c *Cart) Add(it Item) {

-func (c *Cart) Total() int {
-	cut := previousBusinessDay()
+func (c *Cart) Total(now time.Time) int {
+	cut := previousBusinessDay(now)
 	sum := 0
 	for _, it := range c.items {
`,
}

func demoChanges(session string) Changes {
	if session != "s-fern" {
		for _, r := range demoFleet().Rows {
			if r.Name == session && r.Phase != "Running" {
				return Changes{Note: "Changes show while the helper is running.", Files: []FileChange{}}
			}
		}
		return Changes{Branch: "main", Files: []FileChange{}}
	}
	c := Changes{Branch: "fix/monday-checkout"}
	for _, p := range []string{"checkout/clock.go", "checkout/cart.go", "checkout/total_test.go"} {
		f := FileChange{Path: p, Committed: p != "checkout/total_test.go"}
		for _, l := range strings.Split(demoPatches[p], "\n") {
			switch {
			case strings.HasPrefix(l, "+++"), strings.HasPrefix(l, "---"):
			case strings.HasPrefix(l, "+"):
				f.Added++
			case strings.HasPrefix(l, "-"):
				f.Deleted++
			}
		}
		c.Added += f.Added
		c.Deleted += f.Deleted
		c.Files = append(c.Files, f)
	}
	return c
}

func demoPatch(session, path string) Patch {
	if session != "s-fern" {
		return Patch{}
	}
	return Patch{Text: demoPatches[path]}
}
