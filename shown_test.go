package main

import "testing"

func TestSaveNameDefusesWhatCouldRun(t *testing.T) {
	for in, want := range map[string]string{
		"/workspace/shot.png":     "shot.png",
		"/workspace/run.command":  "run.command.download",
		"/workspace/.zshrc":       "zshrc.download",
		"/workspace/a\x1b[2J.pdf": "a[2J.pdf",
		"/":                       "shown.download",
	} {
		if got := saveName(in); got != want {
			t.Errorf("saveName(%q) = %q, want %q", in, got, want)
		}
	}
}
