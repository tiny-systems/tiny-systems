package main

import (
	"fmt"
	"regexp"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	agentsv1 "github.com/tiny-systems/tiny/api/v1alpha1"
	"github.com/tiny-systems/tiny/pkg/fleet"
)

func question(name, session, text, reason, answer string, at time.Time) agentsv1.Question {
	q := agentsv1.Question{ObjectMeta: metav1.ObjectMeta{Name: name, CreationTimestamp: metav1.NewTime(at)}}
	q.Spec.Text, q.Spec.Reason, q.Spec.Session.Name = text, reason, session
	q.Spec.Options = []string{"Yes", "No"}
	q.Status.Answer = answer
	return q
}

func TestFleetFromCountsAndFlags(t *testing.T) {
	ask := question("q1", "fern", "Ship it?", "", "", time.Now())
	idle := question("q2", "moss", "Waiting for your input", "notification", "", time.Now())
	exit := 0
	snap := fleet.Snapshot{
		Rows: []fleet.Row{
			{Name: "fern", Phase: "Running", Pod: "fern-0", Question: &ask, Age: 90 * time.Second},
			{Name: "moss", Phase: "Running", Pod: "moss-0", Question: &idle, Age: 3 * time.Hour},
			{Name: "sage", Phase: "Running", Pod: "sage-0", Paused: true, Age: 72 * time.Hour},
			{Name: "rue", Phase: "Pending", Age: 5 * time.Second},
			{Name: "job", Phase: "Running", Pod: "job-0", Command: true, Exit: &exit},
		},
		Loose: []agentsv1.Question{question("q3", "", "Loose question", "", "", time.Now())},
	}
	f := fleetFrom(Fleet{Target: Target{Name: "home"}}, snap)

	if f.NeedsYou != 3 { // two rows with questions and one loose question
		t.Fatalf("NeedsYou %d, want 3", f.NeedsYou)
	}
	// Paused doesn't count as running; a command session does.
	if f.Running != 3 {
		t.Fatalf("Running %d, want 3 (fern, moss, job)", f.Running)
	}
	rows := map[string]Row{}
	for _, r := range f.Rows {
		rows[r.Name] = r
	}
	if q := rows["fern"].Question; q == nil || q.Session != "fern" || q.Idle || q.Text != "Ship it?" {
		t.Fatalf("fern question %+v", q)
	}
	if q := rows["moss"].Question; q == nil || !q.Idle {
		t.Fatalf("an idle card must be marked idle: %+v", q)
	}
	if !rows["fern"].Attach || rows["rue"].Attach || rows["job"].Attach {
		t.Fatal("attach is only for running agent sessions with a pod")
	}
	if rows["fern"].Age != "1m" || rows["moss"].Age != "3h" || rows["sage"].Age != "3d" || rows["rue"].Age != "5s" {
		t.Fatalf("ages: %s %s %s %s", rows["fern"].Age, rows["moss"].Age, rows["sage"].Age, rows["rue"].Age)
	}
	if len(f.Loose) != 1 || f.Loose[0].Name != "q3" {
		t.Fatalf("loose: %+v", f.Loose)
	}
}

func TestConversationFrom(t *testing.T) {
	t0 := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	se := &agentsv1.Session{ObjectMeta: metav1.ObjectMeta{Name: "fern", CreationTimestamp: metav1.NewTime(t0)}}
	se.Spec.Task = "Fix the flaky test"
	se.Spec.Inbox = []agentsv1.InboxMessage{
		{ID: fmt.Sprintf("m-%d", t0.Add(3*time.Minute).UnixNano()), Text: "Also check the retry"},
		{ID: fmt.Sprintf("m-%d", t0.Add(5*time.Minute).UnixNano()), Text: "Answer to your question q1: Yes"},
	}
	qs := []agentsv1.Question{
		question("q1", "fern", "Pin the timezone?", "", "Yes", t0.Add(4*time.Minute)),
		question("q2", "fern", "Waiting for your input", "notification", "ok", t0.Add(6*time.Minute)), // answered idle: dropped
		question("q3", "fern", "Waiting for your input", "notification", "", t0.Add(7*time.Minute)),
		question("q4", "basil", "Not this helper's", "", "", t0.Add(time.Minute)),
	}
	got := conversationFrom(se, qs)

	want := []struct{ from, text string }{
		{"you", "Fix the flaky test"},
		{"you", "Also check the retry"},
		{"helper", "Pin the timezone?"},
		{"helper", "Waiting for your input"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d messages: %+v", len(got), got)
	}
	for i, w := range want {
		if got[i].From != w.from || got[i].Text != w.text {
			t.Fatalf("message %d = %s %q, want %s %q", i, got[i].From, got[i].Text, w.from, w.text)
		}
	}
	if got[2].Answer != "Yes" || got[2].Open {
		t.Fatalf("answered question: %+v", got[2])
	}
	if !got[3].Open || !got[3].Idle {
		t.Fatalf("open idle card: %+v", got[3])
	}
}

func TestInboxTimeFallsBack(t *testing.T) {
	t0 := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if got := inboxTime("not-an-id", t0); got != t0.Format(time.RFC3339) {
		t.Fatalf("got %q", got)
	}
	if got := inboxTime(fmt.Sprintf("m-%d", t0.UnixNano()), time.Time{}); got != "2026-01-02T03:04:05Z" {
		t.Fatalf("got %q", got)
	}
}

func TestEngineVersionNamesTiny(t *testing.T) {
	// Tests run with the module's real dependencies, so this is the tiny
	// version from go.mod: a release tag, never the app's own version.
	v := engineVersion()
	if !regexp.MustCompile(`^v\d+\.\d+\.\d+$`).MatchString(v) {
		t.Fatalf("engineVersion() = %q, want tiny's release tag", v)
	}
}
