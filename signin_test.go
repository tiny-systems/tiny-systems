package main

import "testing"

func TestClaudeKey(t *testing.T) {
	for in, want := range map[string]string{
		"sk-ant-oat01-abc": keyOAuth,
		"sk-ant-api03-abc": keyAPIKey,
	} {
		if got, err := claudeKey(in); err != nil || got != want {
			t.Fatalf("%s: %s %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "hello", "sk-proj-openai", "sk-ant-oat01-a b", "sk-ant-api03-x\n"} {
		if _, err := claudeKey(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}

func TestWithClaudeTokenReplacesOtherKind(t *testing.T) {
	old := map[string][]byte{keyAPIKey: []byte("sk-ant-api-old"), "OPENAI_API_KEY": []byte("codex")}
	got := withClaudeToken(old, keyOAuth, "sk-ant-oat-new")
	if _, ok := got[keyAPIKey]; ok {
		t.Fatal("old API key kept: it would outrank the new token")
	}
	if string(got[keyOAuth]) != "sk-ant-oat-new" || string(got["OPENAI_API_KEY"]) != "codex" {
		t.Fatalf("got %v", got)
	}
	if string(old[keyAPIKey]) != "sk-ant-api-old" {
		t.Fatal("input map was changed")
	}
}
