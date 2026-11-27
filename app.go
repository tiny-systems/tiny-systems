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
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
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
	// Stage is the startup step of a helper that isn't running yet:
	// "waiting for a machine", "downloading agent:0.18.0 …".
	Stage string `json:"stage,omitempty"`
}

// Asking is a question an agent is waiting on.
type Asking struct {
	Name    string   `json:"name"`
	Session string   `json:"session,omitempty"`
	Text    string   `json:"text"`
	Options []string `json:"options,omitempty"`
	// Idle marks Claude's "waiting for your input" card: the agent finished
	// a turn and wants a message, rather than a tool asking a decision.
	Idle bool `json:"idle"`
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
	openLog()
	fleet.SetVersion(engineVersion()) // helper images are tagged with tiny's version, not the app's
	includeDefaultKubeconfig()
	installReopen()
	startUpdater(loadSettings())
	if !demoOn() && loadSettings().StartVMs {
		go func() { defer guard("start VMs", nil); a.startVMs() }()
	}
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
	if demoOn() {
		out = append(out, demoTarget())
	}
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
	if isDemo(t) {
		return demoFleet()
	}
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
	f = fleetFrom(f, *snap)
	for i, r := range snap.Rows {
		if starting(r) {
			f.Rows[i].Stage, _ = podStage(ctx, store, r.Pod)
		}
	}
	return f
}

// starting is a helper on its way up: not running, not paused, not
// stuck or finished.
func starting(r fleet.Row) bool {
	switch r.Phase {
	case "Running", "stuck", "Failed", "Done":
		return false
	}
	return !r.Paused
}

// fleetFrom turns one read of the cluster into what the window shows.
func fleetFrom(f Fleet, snap fleet.Snapshot) Fleet {
	for _, r := range snap.Rows {
		row := Row{
			Name: r.Name, Parent: r.Parent, Depth: r.Depth, Phase: r.Phase, Glyph: r.Glyph(),
			Title: r.Title, Activity: r.Activity, Message: r.Message, Task: r.Task,
			CPU: r.CPU, Mem: r.Mem, Age: shortAge(r.Age), Paused: r.Paused, Command: r.Command, Exit: r.Exit,
			Attach: r.Pod != "" && r.Phase == "Running" && !r.Command,
		}
		if r.Question != nil {
			row.Question = &Asking{Name: r.Question.Name, Session: r.Name, Text: r.Question.Spec.Text,
				Options: r.Question.Spec.Options, Idle: r.Question.Spec.Reason == "notification"}
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

// Answer resolves a question, performing its action as this user, and
// delivers the text to the agent's inbox. Answering an idle card clears the
// session's older idle cards too: they all say the same thing, and leaving
// them made a sent answer look unsent.
func (a *App) Answer(t Target, q Asking, answer string) error {
	return a.withStore(t, func(ctx context.Context, s *fleet.Client) error {
		if err := s.Answer(ctx, q.Name, answer); err != nil {
			return err
		}
		if q.Idle && q.Session != "" {
			s.ClearAttention(ctx, q.Session)
		}
		return nil
	})
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
	var row *fleet.Row
	for i := range snap.Rows {
		if snap.Rows[i].Name == session {
			row = &snap.Rows[i]
		}
	}
	if row == nil {
		return "", fmt.Errorf("%s is gone", session)
	}
	pod := row.Pod
	switch row.Phase {
	case "stuck", "Failed", "Done":
		if row.Message != "" {
			return "", errors.New(row.Message)
		}
		return "", fmt.Errorf("%s isn't running (%s)", session, strings.ToLower(row.Phase))
	}
	// Attaching before the agent container runs fails ("does not have a
	// host assigned", "container not found"): say which step it's on so
	// the window can show it and try again.
	ctx, cancel = context.WithTimeout(a.ctx, 10*time.Second)
	stage, ready := podStage(ctx, store, pod)
	cancel()
	if !ready {
		return "", errors.New(startingPrefix + stage)
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
		defer guard("terminal", func(error) { runtime.EventsEmit(a.ctx, "term-closed:"+id, "the terminal stopped on an internal error") })
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

// engineVersion is the tiny release this app is built against ("v0.18.0"),
// read from the build. Helper, sidecar and runtime images carry tiny's
// version, so that's what new helpers ask for; the app's own version
// (0.1.x) names no image. Empty for a build against a local checkout,
// and then tiny keeps its default tag.
func engineVersion() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, d := range bi.Deps {
		if d.Path == "github.com/tiny-systems/tiny" {
			if d.Replace != nil {
				return d.Replace.Version
			}
			return d.Version
		}
	}
	return ""
}
