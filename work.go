package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

// Changes is what a helper changed in its project: the Changes tab.
type Changes struct {
	Branch  string       `json:"branch"`
	Files   []FileChange `json:"files"`
	Added   int          `json:"added"`
	Deleted int          `json:"deleted"`
	// Bundles are finished work waiting in the helper's outbox.
	Bundles []string `json:"bundles,omitempty"`
	// Note says why there's nothing to show: no project, not running.
	Note string `json:"note,omitempty"`
}

// FileChange is one changed file. Added and Deleted are -1 for a binary.
type FileChange struct {
	Path      string `json:"path"`
	Added     int    `json:"added"`
	Deleted   int    `json:"deleted"`
	Committed bool   `json:"committed"`
}

// Patch is one file's change as unified diff text.
type Patch struct {
	Text string `json:"text"`
	Cut  bool   `json:"cut"` // longer than the window shows
}

// Changes reads what a running helper changed, live from its workspace.
func (a *App) Changes(t Target, session string) (Changes, error) {
	if isDemo(t) {
		return demoChanges(session), nil
	}
	store, row, err := a.findRow(t, session)
	if err != nil {
		return Changes{}, err
	}
	if row.Pod == "" || row.Phase != "Running" {
		return Changes{Note: "Changes show while the helper is running."}, nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return changesFrom(store.Footprint(ctx, row.Pod)), nil
}

func changesFrom(f fleet.Footprint) Changes {
	c := Changes{Branch: f.Branch, Added: f.Added, Deleted: f.Deleted, Bundles: f.Bundles, Files: []FileChange{}}
	if f.Err != "" {
		c.Note = "No project in this helper’s workspace yet."
		return c
	}
	for _, x := range f.Files {
		c.Files = append(c.Files, FileChange{Path: x.Path, Added: x.Added, Deleted: x.Deleted, Committed: x.Staged})
	}
	return c
}

// FilePatch reads one changed file's diff. Only files the helper's
// footprint lists are read, so the window can't be used to cat anything
// else in the pod.
func (a *App) FilePatch(t Target, session, path string) (Patch, error) {
	if isDemo(t) {
		return demoPatch(session, path), nil
	}
	store, row, err := a.findRow(t, session)
	if err != nil {
		return Patch{}, err
	}
	if row.Pod == "" || row.Phase != "Running" {
		return Patch{}, errors.New("changes show while the helper is running")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	listed := false
	for _, f := range store.Footprint(ctx, row.Pod).Files {
		if f.Path == path {
			listed = true
			break
		}
	}
	if !listed {
		return Patch{}, fmt.Errorf("%s isn’t among this helper’s changes", path)
	}
	text, cut, err := store.FilePatch(ctx, row.Pod, path)
	return Patch{Text: text, Cut: cut}, err
}

// Pulled is where a pull landed and anything worth saying about it.
type Pulled struct {
	Dest string `json:"dest"`
	Note string `json:"note,omitempty"`
}

// Pull copies a helper's project (its files, with uncommitted changes)
// into a new folder the person names, and rebuilds its git history there
// from a bundle: the helper's own .git is never copied, since git would
// run its hooks and settings on this Mac. It never writes into a folder
// that has files in it. Dest is "" if cancelled.
func (a *App) Pull(t Target, session string) (Pulled, error) {
	if isDemo(t) {
		return Pulled{}, errNotInDemo
	}
	store, row, err := a.findRow(t, session)
	if err != nil {
		return Pulled{}, err
	}
	if row.Pod == "" || row.Phase != "Running" {
		return Pulled{}, errors.New("resume the helper to pull its project")
	}
	home, _ := os.UserHomeDir()
	dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:                "Pull the project into a new folder",
		DefaultDirectory:     filepath.Join(home, "Downloads"),
		DefaultFilename:      session,
		CanCreateDirectories: true,
	})
	if err != nil || dest == "" {
		return Pulled{}, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Minute)
	defer cancel()
	res, err := store.PullTree(ctx, row.Pod, "/workspace/repo", dest, nil)
	if err != nil {
		return Pulled{}, err
	}
	return Pulled{Dest: dest, Note: res.Note}, nil
}

// Upload sends files from this computer into the helper's workspace
// (/workspace/uploads) and tells the helper where they are. A stopped
// helper's workspace is reached through a short-lived inspection pod.
// Returns the paths inside the helper.
func (a *App) Upload(t Target, session string, paths []string) ([]string, error) {
	if isDemo(t) {
		return nil, errNotInDemo
	}
	store, err := a.store(t)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, p := range paths {
		ctx, cancel := context.WithTimeout(a.ctx, 15*time.Minute)
		remote, err := store.UploadFile(ctx, session, p, nil)
		cancel()
		if err != nil {
			return out, fmt.Errorf("%s: %w", filepath.Base(p), err)
		}
		out = append(out, remote)
	}
	return out, nil
}

// PickUpload asks for files, then uploads them like Upload.
func (a *App) PickUpload(t Target, session string) ([]string, error) {
	if isDemo(t) {
		return nil, errNotInDemo
	}
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{Title: "Send files to the helper"})
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	return a.Upload(t, session, paths)
}

// OpenShell opens a plain shell on the helper's workspace, beside the
// agent: in its own pod when it runs, or in an inspection pod (removed
// when the shell closes) when it's paused or finished. Same events as
// OpenTerminal.
func (a *App) OpenShell(t Target, session string, cols, rows int) (string, error) {
	store, row, err := a.findRow(t, session)
	if err != nil {
		return "", err
	}
	if row.Pod != "" && row.Phase == "Running" {
		ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
		stage, ready := podStage(ctx, store, row.Pod)
		cancel()
		if !ready {
			return "", errors.New(startingPrefix + stage)
		}
		return a.stream(cols, rows, func(ctx context.Context, in io.Reader, out io.Writer, sizes chan fleet.TerminalSize) error {
			return store.ShellStream(ctx, row.Pod, "", in, out, sizes)
		}, nil), nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 3*time.Minute)
	pod, err := store.EnsureShellPod(ctx, session)
	cancel()
	if err != nil {
		return "", err
	}
	return a.stream(cols, rows, func(ctx context.Context, in io.Reader, out io.Writer, sizes chan fleet.TerminalSize) error {
		return store.ShellStream(ctx, pod, fleet.ShellContainer, in, out, sizes)
	}, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = store.DeleteShellPod(ctx, session)
	}), nil
}

var errNotInDemo = errors.New("not available in the demo garden")
