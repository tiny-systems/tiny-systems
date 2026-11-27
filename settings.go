package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Settings are the app's own preferences. Open at login lives in macOS's
// Login Items, not here, so the switch in System Settings stays the truth.
type Settings struct {
	StartVMs     bool `json:"startVMs"`     // start this Mac's gardens when the app opens
	OpenAtLogin  bool `json:"openAtLogin"`  // read from Login Items, never stored
	CheckUpdates bool `json:"checkUpdates"` // look for a newer release
}

func defaultSettings() Settings { return Settings{StartVMs: true, CheckUpdates: true} }

func appDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "Tiny Systems")
}

func loadSettings() Settings {
	s := defaultSettings()
	if b, err := os.ReadFile(filepath.Join(appDir(), "settings.json")); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

// GetSettings returns the preferences, with open at login read from macOS.
func (a *App) GetSettings() Settings {
	s := loadSettings()
	s.OpenAtLogin = loginItemOn()
	return s
}

// SaveSettings stores the preferences and applies open at login.
func (a *App) SaveSettings(s Settings) error {
	if s.OpenAtLogin != loginItemOn() {
		if err := setLoginItem(s.OpenAtLogin); err != nil {
			return err
		}
	}
	s.OpenAtLogin = false
	b, _ := json.MarshalIndent(s, "", "  ")
	if err := os.MkdirAll(appDir(), 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(appDir(), "settings.json"), append(b, '\n'), 0o600)
}

// SetBadge puts the number of helpers waiting for you on the Dock icon.
func (a *App) SetBadge(n int) { setDockBadge(n) }

// startVMs starts this Mac's stopped gardens, so helpers in them can work
// as soon as the app is open. Lima VMs don't start with the Mac.
func (a *App) startVMs() {
	for _, v := range a.Local().VMs {
		if v.Status != "Stopped" {
			continue
		}
		log.Printf("starting VM %s", v.Name)
		if err := a.StartVM(v.Name); err != nil {
			log.Printf("start VM %s: %v", v.Name, err)
		}
	}
	runtime.EventsEmit(a.ctx, "vms:started")
}

// logPath is the app's log, where Copy diagnostics reads from.
func logPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Logs", "Tiny Systems", "app.log")
}

// openLog sends the standard logger to the log file (and stderr), starting
// it over when it passes 5 MB.
func openLog() {
	p := logPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if st, err := os.Stat(p); err == nil && st.Size() > 5<<20 {
		flags |= os.O_TRUNC
	}
	f, err := os.OpenFile(p, flags, 0o600)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
	log.Printf("Tiny Systems %s starting", version)
}

// Diagnostics is a plain-text report for support: versions, this Mac's
// VMs, each garden's reachability and health, and the end of the log. It
// holds no keys: health reports how helpers sign in, never the key.
func (a *App) Diagnostics() string {
	var b strings.Builder
	w := func(f string, v ...any) { fmt.Fprintf(&b, f+"\n", v...) }
	osv, _ := exec.Command("sw_vers", "-productVersion").Output()
	w("Tiny Systems %s, macOS %s (%s)", version, strings.TrimSpace(string(osv)), goruntime.GOARCH)
	w("Time: %s", time.Now().Format(time.RFC3339))
	if bin, err := limactl(); err == nil {
		lv, _ := exec.Command(bin, "--version").Output()
		w("Lima: %s (%s)", strings.TrimSpace(string(lv)), bin)
	} else {
		w("Lima: %v", err)
	}
	for _, v := range a.Local().VMs {
		w("VM %s: %s", v.Name, v.Status)
	}
	for _, t := range a.Targets() {
		if isDemo(t) {
			continue
		}
		f := a.Fleet(t)
		if f.ErrorText != "" {
			w("Garden %s (%s/%s): unreachable: %s", t.Name, t.Context, t.Namespace, f.ErrorText)
			continue
		}
		h, err := a.Health(t)
		if err != nil {
			w("Garden %s: %d helpers, health: %v", t.Name, len(f.Rows), err)
			continue
		}
		hb, _ := json.Marshal(h)
		w("Garden %s (%s/%s): %d helpers, %d need you; health %s", t.Name, t.Context, t.Namespace, len(f.Rows), f.NeedsYou, hb)
	}
	if l, err := os.ReadFile(logPath()); err == nil {
		lines := strings.Split(strings.TrimRight(string(l), "\n"), "\n")
		if len(lines) > 120 {
			lines = lines[len(lines)-120:]
		}
		w("\nLog (%s):\n%s", logPath(), strings.Join(lines, "\n"))
	}
	return b.String()
}

// CopyDiagnostics puts the report on the clipboard.
func (a *App) CopyDiagnostics() error {
	return runtime.ClipboardSetText(a.ctx, a.Diagnostics())
}
