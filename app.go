package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

// Target is one fleet: a kubeconfig context and a namespace of sessions.
type Target struct {
	Name      string `json:"name"` // a tiny profile name, or "context/namespace"
	Context   string `json:"context"`
	Namespace string `json:"namespace"`
}

// Row is one session as the window shows it.
type Row struct {
	Name     string   `json:"name"`
	Parent   string   `json:"parent,omitempty"`
	Depth    int      `json:"depth"`
	Phase    string   `json:"phase"`
	Glyph    string   `json:"glyph"`
	Title    string   `json:"title"`
	Activity string   `json:"activity"`
	Message  string   `json:"message"`
	Task     string   `json:"task"`
	CPU      string   `json:"cpu"`
	Mem      string   `json:"mem"`
	Age      string   `json:"age"`
	Paused   bool     `json:"paused"`
	Command  bool     `json:"command"`
	Question *Asking  `json:"question,omitempty"`
	Exit     *int     `json:"exit,omitempty"`
	Attach   bool     `json:"attachable"`
	Tags     []string `json:"tags,omitempty"`
}

// Asking is a question an agent is waiting on.
type Asking struct {
	Name    string   `json:"name"`
	Text    string   `json:"text"`
	Options []string `json:"options,omitempty"`
}

// Fleet is one read of a target.
type Fleet struct {
	Target    Target   `json:"target"`
	Rows      []Row    `json:"rows"`
	Loose     []Asking `json:"loose,omitempty"`
	ReadAt    string   `json:"readAt"`
	NeedsYou  int      `json:"needsYou"`
	Running   int      `json:"running"`
	ErrorText string   `json:"error,omitempty"`
}

// App is the backend the window calls.
type App struct {
	ctx    context.Context
	mu     sync.Mutex
	stores map[string]*fleet.Client
	terms  map[string]*terminal
	nextID int
}

func NewApp() *App {
	return &App{stores: map[string]*fleet.Client{}, terms: map[string]*terminal{}}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	fleet.SetVersion(version)
	includeDefaultKubeconfig()
}

// includeDefaultKubeconfig keeps ~/.kube/config in view when KUBECONFIG
// names other files: an app opened from a terminal inherits that shell's
// KUBECONFIG, and contexts the user sees in kubectl elsewhere would vanish.
func includeDefaultKubeconfig() {
	env := os.Getenv("KUBECONFIG")
	home, err := os.UserHomeDir()
	if env == "" || err != nil {
		return
	}
	def := filepath.Join(home, ".kube", "config")
	if _, err := os.Stat(def); err != nil {
		return
	}
	for _, p := range filepath.SplitList(env) {
		if p == def {
			return
		}
	}
	_ = os.Setenv("KUBECONFIG", env+string(os.PathListSeparator)+def)
}

func (a *App) shutdown(context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, t := range a.terms {
		t.cancel()
	}
}

// Version is the app's version, shown in the window.
func (a *App) Version() string { return version }

// Targets lists the fleets the CLI already knows: its saved profiles and
// the pinned target, so the app needs no setup of its own.
func (a *App) Targets() []Target {
	var out []Target
	seen := map[string]bool{}
	add := func(t Target) {
		key := t.Context + "/" + t.Namespace
		if t.Context == "" || seen[key] {
			return
		}
		seen[key] = true
		out = append(out, t)
	}
	cfg := readCLIConfig()
	names := make([]string, 0, len(cfg.Profiles))
	for n := range cfg.Profiles {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		p := cfg.Profiles[n]
		add(Target{Name: n, Context: p.Context, Namespace: orDefault(p.Namespace, "tiny")})
	}
	add(Target{Name: cfg.Context + "/" + orDefault(cfg.Namespace, "tiny"), Context: cfg.Context, Namespace: orDefault(cfg.Namespace, "tiny")})
	return out
}

// Contexts lists the kubeconfig contexts on this machine, for adding a
// fleet the CLI hasn't saved.
func (a *App) Contexts() []string {
	raw, err := clientcmd.NewDefaultClientConfigLoadingRules().Load()
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(raw.Contexts))
	for n := range raw.Contexts {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// Fleet reads a target's sessions. Errors come back inside the result so
// the window can show which fleet is unreachable without failing the rest.
func (a *App) Fleet(t Target) Fleet {
	f := Fleet{Target: t, ReadAt: time.Now().Format("15:04:05")}
	store, err := a.store(t)
	if err != nil {
		f.ErrorText = err.Error()
		return f
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	snap, err := store.Load(ctx)
	if err != nil {
		f.ErrorText = err.Error()
		return f
	}
	for _, r := range snap.Rows {
		row := Row{
			Name: r.Name, Parent: r.Parent, Depth: r.Depth, Phase: r.Phase, Glyph: r.Glyph(),
			Title: r.Title, Activity: r.Activity, Message: r.Message, Task: r.Task,
			CPU: r.CPU, Mem: r.Mem, Age: shortAge(r.Age), Paused: r.Paused, Command: r.Command, Exit: r.Exit,
			Attach: r.Pod != "" && r.Phase == "Running" && !r.Command,
		}
		if r.Question != nil {
			row.Question = &Asking{Name: r.Question.Name, Text: r.Question.Spec.Text, Options: r.Question.Spec.Options}
			f.NeedsYou++
		}
		if r.Phase == "Running" && !r.Paused {
			f.Running++
		}
		f.Rows = append(f.Rows, row)
	}
	for _, q := range snap.Loose {
		f.Loose = append(f.Loose, Asking{Name: q.Name, Text: q.Spec.Text, Options: q.Spec.Options})
		f.NeedsYou++
	}
	return f
}

// Answer resolves a question, performing its action as this user.
func (a *App) Answer(t Target, question, answer string) error {
	return a.withStore(t, func(ctx context.Context, s *fleet.Client) error { return s.Answer(ctx, question, answer) })
}

// Pause scales a session to zero, keeping its workspace.
func (a *App) Pause(t Target, name string) error {
	return a.withStore(t, func(ctx context.Context, s *fleet.Client) error { return s.Pause(ctx, name) })
}

// Resume brings a paused session back.
func (a *App) Resume(t Target, name string) error {
	return a.withStore(t, func(ctx context.Context, s *fleet.Client) error { return s.Resume(ctx, name) })
}

// Delete removes a session with its workspace. The window confirms first.
func (a *App) Delete(t Target, name string) error {
	return a.withStore(t, func(ctx context.Context, s *fleet.Client) error { return s.Delete(ctx, name) })
}

// NewSessionRequest is what the new-session form sends.
type NewSessionRequest struct {
	Task  string `json:"task"`
	Repo  string `json:"repo"`
	Agent string `json:"agent"`
	Model string `json:"model"`
	Image string `json:"image"`
}

// NewSession starts a session and returns its name.
func (a *App) NewSession(t Target, req NewSessionRequest) (string, error) {
	var name string
	err := a.withStore(t, func(ctx context.Context, s *fleet.Client) error {
		se, err := s.Create(ctx, fleet.CreateOpts{Task: req.Task, Repo: req.Repo, Agent: req.Agent, Model: req.Model, Image: req.Image})
		if err == nil {
			name = se.Name
		}
		return err
	})
	return name, err
}

// terminal is one attached session, its output streamed to the window as
// "term:<id>" events and its input fed from TermInput.
type terminal struct {
	in     *io.PipeWriter
	sizes  chan fleet.TerminalSize
	cancel context.CancelFunc
}

// OpenTerminal attaches to a session's tmux and returns the terminal's id.
// Output arrives as base64 in "term:<id>" events; "term-closed:<id>" ends it.
func (a *App) OpenTerminal(t Target, session string, cols, rows int) (string, error) {
	store, err := a.store(t)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	snap, err := store.Load(ctx)
	cancel()
	if err != nil {
		return "", err
	}
	pod := ""
	for _, r := range snap.Rows {
		if r.Name == session {
			pod = r.Pod
		}
	}
	if pod == "" {
		return "", fmt.Errorf("session %s has no running pod to attach to", session)
	}

	a.mu.Lock()
	a.nextID++
	id := strconv.Itoa(a.nextID)
	a.mu.Unlock()

	inR, inW := io.Pipe()
	sizes := make(chan fleet.TerminalSize, 4)
	sizes <- fleet.TerminalSize{Width: uint16(cols), Height: uint16(rows)}
	tctx, tcancel := context.WithCancel(a.ctx)
	term := &terminal{in: inW, sizes: sizes, cancel: tcancel}
	a.mu.Lock()
	a.terms[id] = term
	a.mu.Unlock()

	out := &eventWriter{ctx: a.ctx, event: "term:" + id}
	go func() {
		err := store.AttachStream(tctx, pod, inR, out, sizes)
		reason := ""
		if err != nil && !errors.Is(err, context.Canceled) {
			reason = err.Error()
		}
		a.mu.Lock()
		delete(a.terms, id)
		a.mu.Unlock()
		runtime.EventsEmit(a.ctx, "term-closed:"+id, reason)
	}()
	return id, nil
}

// TermInput sends keystrokes (base64) to a terminal.
func (a *App) TermInput(id, b64 string) error {
	t := a.term(id)
	if t == nil {
		return nil
	}
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return err
	}
	_, err = t.in.Write(b)
	return err
}

// TermResize tells the session's tmux the window's new size.
func (a *App) TermResize(id string, cols, rows int) {
	if t := a.term(id); t != nil {
		select {
		case t.sizes <- fleet.TerminalSize{Width: uint16(cols), Height: uint16(rows)}:
		default:
		}
	}
}

// CloseTerminal detaches. The agent keeps running.
func (a *App) CloseTerminal(id string) {
	if t := a.term(id); t != nil {
		_ = t.in.Close()
		t.cancel()
	}
}

func (a *App) term(id string) *terminal {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.terms[id]
}

// eventWriter forwards terminal output to the window.
type eventWriter struct {
	ctx   context.Context
	event string
}

func (w *eventWriter) Write(p []byte) (int, error) {
	runtime.EventsEmit(w.ctx, w.event, base64.StdEncoding.EncodeToString(p))
	return len(p), nil
}

func (a *App) store(t Target) (*fleet.Client, error) {
	key := t.Context + "/" + t.Namespace
	a.mu.Lock()
	defer a.mu.Unlock()
	if s, ok := a.stores[key]; ok {
		return s, nil
	}
	c, err := fleet.Connect(t.Context, t.Namespace)
	if err != nil {
		return nil, err
	}
	c.Version = version
	a.stores[key] = c
	return c, nil
}

func (a *App) withStore(t Target, f func(context.Context, *fleet.Client) error) error {
	s, err := a.store(t)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, time.Minute)
	defer cancel()
	return f(ctx, s)
}

// cliConfig is the part of the tiny CLI's config file the app reads.
type cliConfig struct {
	Context   string `json:"context"`
	Namespace string `json:"namespace"`
	Profiles  map[string]struct {
		Context   string `json:"context"`
		Namespace string `json:"namespace"`
	} `json:"profiles"`
}

func readCLIConfig() cliConfig {
	var c cliConfig
	dir, err := os.UserConfigDir()
	if err != nil {
		return c
	}
	b, err := os.ReadFile(filepath.Join(dir, "tiny", "config.json"))
	if err != nil {
		return c
	}
	_ = json.Unmarshal(b, &c)
	return c
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

func shortAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}
