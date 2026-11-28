package main

import (
	"context"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"

	agentsv1 "github.com/tiny-systems/tiny/api/v1alpha1"
	"github.com/tiny-systems/tiny/pkg/fleet"
)

// Message is one entry in a helper's conversation, rebuilt from what tiny
// stores: the task it was given, messages sent to its inbox, and the
// questions it asked with their answers.
type Message struct {
	From     string   `json:"from"` // "you" or "helper"
	Text     string   `json:"text"`
	At       string   `json:"at"` // RFC 3339
	Question string   `json:"question,omitempty"`
	Options  []string `json:"options,omitempty"`
	Answer   string   `json:"answer,omitempty"`
	Open     bool     `json:"open,omitempty"` // a question still waiting
	Idle     bool     `json:"idle,omitempty"` // "waiting for your input", not a real question
	// File is a path in the helper's container that it showed you
	// (show_user); Text is its caption. ReadShown fetches it.
	File string `json:"file,omitempty"`
	// Action is what allowing a permission question does (see Asking).
	Action *Action `json:"action,omitempty"`
}

// Conversation returns a helper's history, oldest first.
func (a *App) Conversation(t Target, session string) ([]Message, error) {
	if isDemo(t) {
		return demoConversation(session), nil
	}
	var out []Message
	err := a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		se := &agentsv1.Session{}
		if err := c.Kube.Client.Get(ctx, client.ObjectKey{Namespace: c.Kube.Namespace, Name: session}, se); err != nil {
			return err
		}
		qs := &agentsv1.QuestionList{}
		if err := c.Kube.Client.List(ctx, qs, client.InNamespace(c.Kube.Namespace)); err != nil {
			return err
		}
		out = conversationFrom(se, qs.Items)
		return nil
	})
	return out, err
}

// conversationFrom rebuilds a helper's history from its Session and the
// namespace's questions, oldest first.
func conversationFrom(se *agentsv1.Session, qs []agentsv1.Question) []Message {
	var out []Message
	if se.Spec.Task != "" {
		out = append(out, Message{From: "you", Text: se.Spec.Task, At: se.CreationTimestamp.Format(time.RFC3339)})
	}
	for _, m := range se.Spec.Inbox {
		// Answers are copied into the inbox for the agent; the
		// question below already shows them.
		if strings.HasPrefix(m.Text, "Answer to your question ") {
			continue
		}
		out = append(out, Message{From: "you", Text: m.Text, At: inboxTime(m.ID, se.CreationTimestamp.Time)})
	}
	for _, q := range qs {
		if q.Spec.Session.Name != se.Name {
			continue
		}
		idle := q.Spec.Reason == "notification"
		// Idle cards that were answered or cleared say nothing worth
		// keeping in the history.
		if idle && q.Answered() {
			continue
		}
		out = append(out, Message{
			From: "helper", Text: q.Spec.Text, At: q.CreationTimestamp.Format(time.RFC3339),
			Question: q.Name, Options: q.Spec.Options, Answer: q.Status.Answer, Open: !q.Answered(), Idle: idle,
			Action: actionOf(&q),
		})
	}
	for _, f := range se.Status.Shown {
		out = append(out, Message{From: "helper", File: f.Path, Text: f.Caption, At: f.At.UTC().Format(time.RFC3339)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At < out[j].At })
	return out
}

// inboxTime reads the time out of an inbox id ("m-<unix nanoseconds>").
func inboxTime(id string, fallback time.Time) string {
	if n, err := strconv.ParseInt(strings.TrimPrefix(id, "m-"), 10, 64); err == nil && n > 0 {
		return time.Unix(0, n).UTC().Format(time.RFC3339)
	}
	return fallback.Format(time.RFC3339)
}

// SendMessage puts a message in a helper's inbox; it reaches the helper's
// prompt within seconds, even after a restart.
func (a *App) SendMessage(t Target, session, text string) error {
	if isDemo(t) {
		return nil
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error { return c.SendText(ctx, session, text) })
}

// Garden describes one garden for the Gardens screen.
type Garden struct {
	Target   Target `json:"target"`
	Where    string `json:"where"`    // "This Mac" or the computer's address
	Local    bool   `json:"local"`    // a VM on this Mac
	VMStatus string `json:"vmStatus"` // for local gardens: Running, Stopped
}

// Gardens lists the gardens with where each one lives.
func (a *App) Gardens() []Garden {
	vms := map[string]string{}
	for _, v := range a.Local().VMs {
		vms[v.Name] = v.Status
	}
	raw, _ := clientcmd.NewDefaultClientConfigLoadingRules().Load()
	var out []Garden
	for _, t := range a.Targets() {
		g := Garden{Target: t}
		if isDemo(t) {
			g.Where = "Demo"
			out = append(out, g)
			continue
		}
		if st, ok := vms[t.Context]; ok {
			g.Where, g.Local, g.VMStatus = "This Mac", true, st
		} else if raw != nil {
			if c := raw.Contexts[t.Context]; c != nil {
				if cl := raw.Clusters[c.Cluster]; cl != nil {
					if u, err := url.Parse(cl.Server); err == nil {
						g.Where = u.Hostname()
					}
				}
			}
		}
		out = append(out, g)
	}
	return out
}
