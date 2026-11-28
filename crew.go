package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

/* Working with several helpers: one message to many, passing a note or a
   file from one helper to another, starting a helper from a folder on this
   Mac (or continuing a Claude Code session from it), and exporting a
   conversation. */

// Recipient is one helper in one garden.
type Recipient struct {
	Target  Target `json:"target"`
	Session string `json:"session"`
}

// Sent is how a message to several helpers went.
type Sent struct {
	Delivered []string `json:"delivered"`
	Failed    []string `json:"failed,omitempty"` // "name: why"
}

// SendMany puts one message in several helpers' inboxes. A failure for one
// doesn't stop the rest.
func (a *App) SendMany(to []Recipient, text string) (Sent, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Sent{}, errors.New("write a message first")
	}
	var out Sent
	for _, r := range to {
		err := a.SendMessage(r.Target, r.Session, text)
		if err != nil {
			out.Failed = append(out.Failed, r.Session+": "+plainError(err))
			continue
		}
		out.Delivered = append(out.Delivered, r.Session)
	}
	return out, nil
}

// maxDeliver caps a file passed between helpers; it travels through this
// Mac's memory.
const maxDeliver = 25 << 20

// Deliver passes a note, and optionally a file from the first helper's
// workspace, to another helper. The file lands in the receiver's
// /workspace/uploads and the receiver is told where, with the note.
func (a *App) Deliver(from Recipient, to Recipient, note, file string) error {
	note, file = strings.TrimSpace(note), strings.TrimSpace(file)
	if note == "" && file == "" {
		return errors.New("write a note or name a file to send")
	}
	if isDemo(from.Target) || isDemo(to.Target) {
		return errNotInDemo
	}
	if from.Target == to.Target && from.Session == to.Session {
		return errors.New("pick a different helper to send to")
	}
	intro := fmt.Sprintf("From %s: ", from.Session)
	if file != "" {
		if !path.IsAbs(file) {
			file = path.Join("/workspace/repo", file)
		}
		store, row, err := a.findRow(from.Target, from.Session)
		if err != nil {
			return err
		}
		if row.Pod == "" || row.Phase != "Running" {
			return fmt.Errorf("%s isn't running, so its files can't be read; resume it first", from.Session)
		}
		ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
		data, err := store.ReadFile(ctx, row.Pod, path.Clean(file), maxDeliver)
		cancel()
		if err != nil {
			return err
		}
		dir, err := os.MkdirTemp("", "tiny-deliver-")
		if err != nil {
			return err
		}
		defer func() { _ = os.RemoveAll(dir) }()
		local := filepath.Join(dir, safeLocalName(path.Base(file)))
		if err := os.WriteFile(local, data, 0o600); err != nil {
			return err
		}
		toStore, err := a.store(to.Target)
		if err != nil {
			return err
		}
		ctx, cancel = context.WithTimeout(a.ctx, 10*time.Minute)
		remote, err := toStore.UploadFile(ctx, to.Session, local, nil)
		cancel()
		if err != nil {
			return err
		}
		if note == "" {
			note = "sent you " + remote
		} else {
			note += "\n\n(The file is at " + remote + ".)"
		}
	}
	return a.SendMessage(to.Target, to.Session, intro+note)
}

// safeLocalName keeps a pod file's name usable on this Mac.
func safeLocalName(n string) string {
	n = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '/' || r == '\\' || r == ':' {
			return '_'
		}
		return r
	}, n)
	n = strings.TrimLeft(n, ".")
	if n == "" {
		return "file"
	}
	return n
}

// ExportConversation saves a helper's conversation as Markdown where the
// person picks. Returns the path, or "" if cancelled.
func (a *App) ExportConversation(t Target, session string) (string, error) {
	msgs, err := a.Conversation(t, session)
	if err != nil {
		return "", err
	}
	home, _ := os.UserHomeDir()
	dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Export the conversation",
		DefaultDirectory: filepath.Join(home, "Downloads"),
		DefaultFilename:  session + ".md",
		Filters:          []runtime.FileFilter{{DisplayName: "Markdown", Pattern: "*.md"}},
	})
	if err != nil || dest == "" {
		return "", err
	}
	return dest, os.WriteFile(dest, []byte(conversationMarkdown(session, msgs)), 0o644)
}

// conversationMarkdown writes a conversation as a readable document.
func conversationMarkdown(session string, msgs []Message) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", session)
	for _, m := range msgs {
		at := m.At
		if t, err := time.Parse(time.RFC3339, m.At); err == nil {
			at = t.Local().Format("2 Jan 2006 15:04")
		}
		who := "You"
		if m.From == "helper" {
			who = session
		}
		fmt.Fprintf(&b, "**%s** · %s\n\n", who, at)
		switch {
		case m.File != "":
			if m.Text != "" {
				b.WriteString(quote(m.Text) + "\n\n")
			}
			fmt.Fprintf(&b, "Showed a file: `%s`\n\n", m.File)
		case m.Question != "":
			if m.Idle {
				b.WriteString("Finished a step and waited for you.\n\n")
			} else {
				b.WriteString(quote(m.Text) + "\n\n")
			}
			if m.Action != nil {
				fmt.Fprintf(&b, "Asked permission: %s %v\n\n", m.Action.Type, m.Action.Params)
			}
			if len(m.Options) > 0 {
				fmt.Fprintf(&b, "Options: %s\n\n", strings.Join(m.Options, " · "))
			}
			switch {
			case m.Answer != "":
				fmt.Fprintf(&b, "**You answered:** %s\n\n", m.Answer)
			case m.Open:
				b.WriteString("_Still waiting for an answer._\n\n")
			}
		default:
			b.WriteString(quote(m.Text) + "\n\n")
		}
	}
	return b.String()
}

// quote keeps a message's own line breaks and stops it from being read as
// Markdown headings or rules.
func quote(s string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	for i, l := range lines {
		lines[i] = "> " + l
	}
	return strings.Join(lines, "\n")
}

// PickFolder asks for a folder on this Mac. "" if cancelled.
func (a *App) PickFolder(title string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: title, CanCreateDirectories: false})
}

// FolderInfo says what a folder would bring to a new helper.
type FolderInfo struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// Session is true when Claude Code has a conversation for this folder
	// that a helper can continue.
	Session bool `json:"session"`
	// Recent is set when that conversation was written in the last 90
	// seconds: Claude Code is probably still running there.
	Recent bool `json:"recent"`
}

// Folder describes a folder for the New helper form.
func (a *App) Folder(dir string) (FolderInfo, error) {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return FolderInfo{}, err
	}
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return FolderInfo{}, fmt.Errorf("%s isn't a folder", dir)
	}
	info := FolderInfo{Path: dir, Name: filepath.Base(dir)}
	if t, err := latestTranscript(transcriptDir(dir)); err == nil {
		info.Session = true
		info.Recent = time.Since(mtime(t)) < 90*time.Second
	}
	return info, nil
}

var notAlnum = regexp.MustCompile(`[^A-Za-z0-9]`)

// transcriptDir is where Claude Code keeps a folder's conversations: every
// character of the path that isn't a letter or digit becomes '-'.
func transcriptDir(dir string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "projects", notAlnum.ReplaceAllString(dir, "-"))
}

func latestTranscript(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".jsonl" {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	if len(files) == 0 {
		return "", fmt.Errorf("no conversations in %s", dir)
	}
	sort.Slice(files, func(i, j int) bool { return mtime(files[i]).After(mtime(files[j])) })
	return files[0], nil
}

func mtime(p string) time.Time {
	st, err := os.Stat(p)
	if err != nil {
		return time.Time{}
	}
	return st.ModTime()
}

// workspaceSlug is the transcript folder a conversation needs inside the
// helper, where the project lives at /workspace/repo.
const workspaceSlug = "-workspace-repo"

// ship sends a local folder (and, to continue it, its Claude Code
// conversation) into a new helper once its pod runs. Progress shows as the
// helper's startup stage; a failure shows as a toast and in the stage.
func (a *App) ship(t Target, store *fleet.Client, name, dir string, withSession bool) {
	defer guard("ship", nil)
	set := func(stage string) { a.setShipping(t, name, stage) }
	defer a.setShipping(t, name, "")
	fail := func(err error) {
		a.emit("ship:failed", name, plainError(err))
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Minute)
	defer cancel()
	var pod string
	for {
		stage, p, failure, err := store.Birth(ctx, name)
		if err != nil {
			fail(err)
			return
		}
		if failure != "" {
			fail(errors.New(failure))
			return
		}
		if stage == "" {
			pod = p
			break
		}
		select {
		case <-ctx.Done():
			fail(ctx.Err())
			return
		case <-time.After(2 * time.Second):
		}
	}
	files := 0
	set("sending " + filepath.Base(dir) + " from this Mac")
	if err := store.PushTree(ctx, pod, "/workspace/repo", dir, func(string) {
		files++
		if files%200 == 0 {
			set(fmt.Sprintf("sending %s from this Mac (%d files)", filepath.Base(dir), files))
		}
	}); err != nil {
		fail(err)
		return
	}
	if withSession {
		set("sending the Claude Code conversation")
		if err := store.PushTree(ctx, pod, "/workspace/.claude/projects/"+workspaceSlug, transcriptDir(dir), nil); err != nil {
			fail(err)
			return
		}
	}
	if err := store.MarkHandoffComplete(ctx, pod); err != nil {
		fail(err)
		return
	}
	a.emit("ship:done", name, files)
}

func (a *App) setShipping(t Target, name, stage string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.shipping == nil {
		a.shipping = map[string]string{}
	}
	key := t.Context + "/" + t.Namespace + "/" + name
	if stage == "" {
		delete(a.shipping, key)
		return
	}
	a.shipping[key] = stage
}

func (a *App) shippingStage(t Target, name string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.shipping[t.Context+"/"+t.Namespace+"/"+name]
}

// emit sends an event to the window; tests replace it (a.emitTo).
func (a *App) emit(name string, data ...any) {
	if a.emitTo != nil {
		a.emitTo(name, data...)
		return
	}
	runtime.EventsEmit(a.ctx, name, data...)
}
