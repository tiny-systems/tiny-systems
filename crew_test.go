package main

import (
	"strings"
	"testing"
)

func TestConversationMarkdownReadsLikeTheChat(t *testing.T) {
	md := conversationMarkdown("s-fern", []Message{
		{From: "you", Text: "Fix the test\n# not a heading", At: "2026-11-28T09:00:00Z"},
		{From: "helper", Question: "q1", Text: "UTC or every zone?", Options: []string{"UTC", "Every"}, Answer: "UTC", At: "2026-11-28T09:05:00Z"},
		{From: "helper", File: "/workspace/notes/chart.png", Text: "Mondays fail", At: "2026-11-28T09:06:00Z"},
		{From: "helper", Question: "q2", Text: "Open port?", Open: true, Action: &Action{Type: "exposePort", Params: map[string]string{"port": "5173"}}, At: "2026-11-28T09:07:00Z"},
	})
	for _, want := range []string{"# s-fern", "> Fix the test\n> # not a heading", "**You answered:** UTC", "Options: UTC · Every", "Showed a file: `/workspace/notes/chart.png`", "Asked permission: exposePort", "_Still waiting for an answer._"} {
		if !strings.Contains(md, want) {
			t.Errorf("missing %q in:\n%s", want, md)
		}
	}
}

func TestSafeLocalNameKeepsAFileInItsFolder(t *testing.T) {
	for in, want := range map[string]string{"../../x": "_.._x", ".bashrc": "bashrc", "a\x1b[2Jb": "a_[2Jb", "": "file", "...": "file", "report.pdf": "report.pdf"} {
		if got := safeLocalName(in); got != want {
			t.Errorf("safeLocalName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTranscriptDirMatchesClaudeCode(t *testing.T) {
	if got := transcriptDir("/Users/me/Work/my.app"); !strings.HasSuffix(got, "/.claude/projects/-Users-me-Work-my-app") {
		t.Errorf("transcriptDir = %q", got)
	}
}
