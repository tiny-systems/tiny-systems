package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

// Local VMs are Lima instances named with this prefix, so the app only
// ever lists and touches its own.
const vmPrefix = "tiny-"

// LocalInstallRequest is the "this Mac" form.
type LocalInstallRequest struct {
	Name     string  `json:"name"`
	CPUs     int     `json:"cpus"`
	MemoryGB int     `json:"memoryGB"`
	DiskGB   int     `json:"diskGB"`
	GVisor   bool    `json:"gvisor"`
	CopyFrom *Target `json:"copyFrom,omitempty"`
	Token    string  `json:"token,omitempty"`
}

// VM is one of the app's Lima machines.
type VM struct {
	Name   string `json:"name"`   // the fleet name, without the prefix
	Status string `json:"status"` // Running, Stopped, ...
}

// LocalStatus says whether Lima is installed and lists the app's VMs.
type LocalStatus struct {
	Lima bool   `json:"lima"`
	VMs  []VM   `json:"vms"`
	Hint string `json:"hint,omitempty"`
}

// limactl finds Lima's CLI: the copy inside the app first (a release
// bundles one, see scripts/fetch-lima.sh), then a Homebrew install for
// development builds. An app opened from Finder doesn't get the shell's
// PATH, so Homebrew's folders are tried by name.
func limactl() (string, error) {
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), "..", "Resources", "lima", "bin", "limactl")
		if _, err := os.Stat(p); err == nil {
			return filepath.Clean(p), nil
		}
	}
	if p, err := exec.LookPath("limactl"); err == nil {
		return p, nil
	}
	for _, p := range []string{"/opt/homebrew/bin/limactl", "/usr/local/bin/limactl"} {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", errors.New("this copy of Tiny Systems is missing its VM tools: download it again from tinysystems.io (or, for a development build, brew install lima)")
}

// Local reports Lima and the app's VMs.
func (a *App) Local() LocalStatus {
	bin, err := limactl()
	if err != nil {
		return LocalStatus{Hint: err.Error()}
	}
	st := LocalStatus{Lima: true}
	out, err := exec.Command(bin, "list", "--json").Output()
	if err != nil {
		st.Hint = "limactl list failed: " + err.Error()
		return st
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		var v struct{ Name, Status string }
		if json.Unmarshal([]byte(line), &v) == nil && strings.HasPrefix(v.Name, vmPrefix) {
			st.VMs = append(st.VMs, VM{Name: strings.TrimPrefix(v.Name, vmPrefix), Status: v.Status})
		}
	}
	return st
}

// StartVM starts a stopped local VM (Lima VMs don't start with the Mac).
func (a *App) StartVM(name string) error {
	return a.limaRun(5*time.Minute, "start", "--tty=false", vmPrefix+name)
}

// StopVM stops a local VM; its sessions pause until it starts again.
func (a *App) StopVM(name string) error {
	return a.limaRun(2*time.Minute, "stop", vmPrefix+name)
}

func (a *App) limaRun(timeout time.Duration, args ...string) error {
	bin, err := limactl()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("limactl %s: %s", args[0], lastLines(strings.TrimSpace(string(out)), 3))
	}
	return nil
}

// InstallLocal creates a Lima VM on this Mac and sets it up as a fleet
// with the same installer as any other machine, over the SSH port Lima
// forwards. Progress arrives as "install:event", like Install.
func (a *App) InstallLocal(req LocalInstallRequest) error {
	if !regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`).MatchString(req.Name) {
		return errors.New("name: lowercase letters, digits and dashes")
	}
	bin, err := limactl()
	if err != nil {
		return err
	}
	if req.CPUs == 0 {
		req.CPUs = 2
	}
	if req.MemoryGB == 0 {
		req.MemoryGB = 4
	}
	if req.DiskGB == 0 {
		req.DiskGB = 40
	}
	go func() {
		emit := func(e InstallEvent) {
			log.Printf("setup %s %s: %s", e.Step, e.Level, e.Text)
			runtime.EventsEmit(a.ctx, "install:event", e)
		}
		ctx, cancel := context.WithTimeout(a.ctx, 40*time.Minute)
		defer cancel()
		t, err := a.installLocal(ctx, bin, req, emit)
		if err != nil {
			emit(InstallEvent{Step: "log", Level: "log", Text: err.Error()})
			emit(InstallEvent{Step: "done", Level: "error", Text: plainError(err)})
			return
		}
		emit(InstallEvent{Step: "done", Level: "ok", Text: "ready: " + t.Name, Data: t})
	}()
	return nil
}

func (a *App) installLocal(ctx context.Context, bin string, req LocalInstallRequest, emit func(InstallEvent)) (*Target, error) {
	vm := vmPrefix + req.Name
	emit(InstallEvent{Step: "vm", Level: "info", Text: fmt.Sprintf("creating VM %s: %d CPUs, %d GB memory, %d GB disk (first time downloads Ubuntu)", vm, req.CPUs, req.MemoryGB, req.DiskGB)})
	start := exec.CommandContext(ctx, bin, "start", "--name", vm, "--tty=false",
		"--cpus", strconv.Itoa(req.CPUs), "--memory", strconv.Itoa(req.MemoryGB), "--disk", strconv.Itoa(req.DiskGB),
		// No folders from this Mac in the VM (Lima mounts your home by
		// default), and no extra containerd: k3s brings its own.
		"--mount-none", "--containerd", "none",
		"template://ubuntu-lts")
	if st := a.Local(); hasVM(st.VMs, req.Name) {
		start = exec.CommandContext(ctx, bin, "start", "--tty=false", vm) // already created: just make sure it runs
	}
	if out, err := start.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("lima: %s", lastLines(strings.TrimSpace(string(out)), 3))
	}
	emit(InstallEvent{Step: "vm", Level: "ok", Text: "VM running"})

	opts, err := exec.CommandContext(ctx, bin, "show-ssh", "--format", "options", vm).Output()
	if err != nil {
		return nil, fmt.Errorf("lima show-ssh: %w", err)
	}
	port := regexp.MustCompile(`Port=(\d+)`).FindStringSubmatch(string(opts))
	user := regexp.MustCompile(`User=(\S+)`).FindStringSubmatch(string(opts))
	if port == nil || user == nil {
		return nil, errors.New("can't read the VM's SSH settings from lima")
	}
	p, _ := strconv.Atoi(port[1])
	ireq := InstallRequest{
		Name: req.Name, Host: "127.0.0.1", Port: p, User: strings.Trim(user[1], `"`),
		KeyFile: filepath.Join(limaHome(), "_config", "user"), Namespace: "tiny",
		GVisor: req.GVisor, CopyFrom: req.CopyFrom, Token: req.Token, APIPort: freeAPIPort(),
	}
	// The VM was created here a moment ago and is reached over localhost,
	// so its host key is trusted on first sight, not shown for checking.
	t, err := a.install(ctx, ireq, emit)
	var uh UnknownHostError
	if errors.As(err, &uh) {
		ireq.TrustFingerprint = uh.Fingerprint
		t, err = a.install(ctx, ireq, emit)
	}
	return t, err
}

// limaHome is where Lima keeps its VMs and key: $LIMA_HOME, else ~/.lima.
func limaHome() string {
	if h := os.Getenv("LIMA_HOME"); h != "" {
		return h
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".lima")
}

func hasVM(vms []VM, name string) bool {
	for _, v := range vms {
		if v.Name == name {
			return true
		}
	}
	return false
}

// freeAPIPort picks the Kubernetes API port for a new local VM. Lima
// forwards it to this Mac's localhost, where two VMs can't share 6443.
func freeAPIPort() int {
	for p := 6443; p < 6543; p++ {
		l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p))
		if err == nil {
			_ = l.Close()
			return p
		}
	}
	return 6443
}

// Health reads what can quietly break a fleet; see fleet.Health.
func (a *App) Health(t Target) (fleet.Health, error) {
	var h fleet.Health
	if isDemo(t) {
		return fleet.Health{SignIn: fleet.SignInStored, Sandbox: "gvisor", SandboxAvailable: true}, nil
	}
	err := a.withStore(t, func(ctx context.Context, s *fleet.Client) error {
		var err error
		h, err = s.Health(ctx)
		return err
	})
	return h, err
}

// UpgradeRuntime is `tiny init` for one fleet.
func (a *App) UpgradeRuntime(t Target) error {
	return a.withStore(t, func(ctx context.Context, s *fleet.Client) error { return s.UpgradeRuntime(ctx) })
}

// CopyCredentials copies agent credentials from one fleet to another.
func (a *App) CopyCredentials(from, to Target) error {
	ctx, cancel := context.WithTimeout(a.ctx, time.Minute)
	defer cancel()
	return a.copyCredentials(ctx, from, to)
}

// Notify shows a macOS notification. Wails v2 has none of its own, so it
// goes through osascript; the text is passed as arguments, never parsed
// as script.
func (a *App) Notify(title, body string) {
	script := `on run argv
display notification (item 2 of argv) with title (item 1 of argv)
end run`
	_ = exec.Command("osascript", "-e", script, title, body).Start()
}

// SetSandbox turns the garden's sandbox on (every new helper runs under
// gVisor) or off. Helpers already running keep the runtime they have.
func (a *App) SetSandbox(t Target, on bool) error {
	if isDemo(t) {
		return nil
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		if on {
			return c.SandboxOn(ctx, "gvisor")
		}
		return c.SandboxOff(ctx)
	})
}
