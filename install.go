package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"github.com/tiny-systems/tiny/pkg/fleet"
	tinyruntime "github.com/tiny-systems/tiny/pkg/runtime"
)

// InstallRequest is what the "add a machine" form sends.
type InstallRequest struct {
	Name     string `json:"name"` // fleet and kubeconfig context name
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	KeyFile  string `json:"keyFile"` // optional; the SSH agent and ~/.ssh keys are tried too
	Password string `json:"password"`
	// SudoPassword is used for this install only, piped to sudo -S, never
	// stored. Empty means root or passwordless sudo.
	SudoPassword string `json:"sudoPassword"`
	Namespace    string `json:"namespace"`
	GVisor       bool   `json:"gvisor"`
	// APIPort is where k3s serves the Kubernetes API; 6443 unless several
	// machines share one address (local VMs all forward to localhost).
	APIPort int `json:"apiPort"`
	// TrustFingerprint is the host key fingerprint the user confirmed for a
	// host not yet in known_hosts.
	TrustFingerprint string `json:"trustFingerprint"`
	// CopyFrom, when set, copies the agent credentials (tiny-agent-env)
	// from an existing fleet, so sessions can sign in straight away.
	CopyFrom *Target `json:"copyFrom,omitempty"`
	// Token, when set instead, is a pasted Claude key to sign helpers in
	// with. Stored like SignIn stores it; never logged.
	Token string `json:"token,omitempty"`
}

// InstallEvent is one line of progress, sent as "install:event".
type InstallEvent struct {
	Step  string `json:"step"`  // connect, preflight, k3s, gvisor, kubeconfig, runtime, credentials, done
	Level string `json:"level"` // info, ok, warn, error, log
	Text  string `json:"text"`
	Data  any    `json:"data,omitempty"` // done: the new Target; hostkey: {fingerprint}
}

// gVisor release the installer pins; verified on k3s.
const gvisorRelease = "20261102.0"

// UnknownHostError asks the window to show a fingerprint for confirmation.
type UnknownHostError struct{ Fingerprint string }

func (e UnknownHostError) Error() string {
	return "this computer's SSH host key isn't known yet: " + e.Fingerprint
}

// Install sets up a computer on the network as a tiny fleet: k3s, gVisor
// if asked, the kubeconfig merged into ~/.kube/config, tiny's runtime and
// a saved profile. It runs in the background; progress arrives as
// "install:event" and the end as an event with step "done".
func (a *App) Install(req InstallRequest) error {
	if req.Host == "" || req.User == "" || req.Name == "" {
		return errors.New("name, host and user are required")
	}
	if !regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`).MatchString(req.Name) {
		return errors.New("name: lowercase letters, digits and dashes")
	}
	if req.Port == 0 {
		req.Port = 22
	}
	if req.Namespace == "" {
		req.Namespace = "tiny"
	}
	if req.APIPort == 0 {
		req.APIPort = 6443
	}
	go func() {
		emit := func(e InstallEvent) {
			log.Printf("setup %s %s: %s", e.Step, e.Level, e.Text)
			runtime.EventsEmit(a.ctx, "install:event", e)
		}
		defer guard("setup", func(err error) {
			emit(InstallEvent{Step: "done", Level: "error", Text: "setup stopped on an internal error; Copy diagnostics has the details"})
		})
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Minute)
		defer cancel()
		t, err := a.install(ctx, req, emit)
		if err != nil {
			var uh UnknownHostError
			if errors.As(err, &uh) {
				emit(InstallEvent{Step: "connect", Level: "hostkey", Text: err.Error(), Data: map[string]string{"fingerprint": uh.Fingerprint}})
				return
			}
			emit(InstallEvent{Step: "log", Level: "log", Text: err.Error()})
			emit(InstallEvent{Step: "done", Level: "error", Text: plainError(err)})
			return
		}
		emit(InstallEvent{Step: "done", Level: "ok", Text: "ready: " + t.Name, Data: t})
	}()
	return nil
}

func (a *App) install(ctx context.Context, req InstallRequest, emit func(InstallEvent)) (*Target, error) {
	say := func(step, level, f string, args ...any) {
		emit(InstallEvent{Step: step, Level: level, Text: fmt.Sprintf(f, args...)})
	}

	say("connect", "info", "connecting to %s@%s:%d", req.User, req.Host, req.Port)
	r, err := dialRemote(req, func(line string) { say("log", "log", "%s", line) })
	if err != nil {
		return nil, err
	}
	defer func() { _ = r.client.Close() }()
	osArch, err := r.out("uname -sm", false)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(osArch, "Linux") {
		return nil, fmt.Errorf("%s runs %s; this installer sets up Linux machines (Macs come later)", req.Host, osArch)
	}
	if err := r.checkSudo(); err != nil {
		return nil, err
	}
	say("connect", "ok", "connected: %s, %s", osArch, r.who())

	say("preflight", "info", "checking the machine")
	if err := preflight(r, say); err != nil {
		return nil, err
	}

	if have, _ := r.out("command -v k3s || true", false); have != "" {
		say("k3s", "ok", "k3s is already installed; keeping it")
	} else {
		say("k3s", "info", "installing k3s (a couple of minutes)")
		cmd := fmt.Sprintf("curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC=%s sh -",
			shellQuote(fmt.Sprintf("server --write-kubeconfig-mode 600 --tls-san %s --https-listen-port %d", req.Host, apiPort(req))))
		if err := r.stream(cmd, true); err != nil {
			return nil, fmt.Errorf("k3s install failed: %w", err)
		}
	}
	if err := waitNodeReady(ctx, r); err != nil {
		return nil, err
	}
	say("k3s", "ok", "node ready")

	if req.GVisor {
		say("gvisor", "info", "installing gVisor %s", gvisorRelease)
		if err := installGVisor(ctx, r, say); err != nil {
			return nil, fmt.Errorf("gVisor: %w", err)
		}
	}

	say("kubeconfig", "info", "adding %s to ~/.kube/config", req.Name)
	raw, err := r.out("cat /etc/rancher/k3s/k3s.yaml", true)
	if err != nil {
		return nil, fmt.Errorf("read k3s kubeconfig: %w", err)
	}
	kubeconfigPath, backup, err := mergeKubeconfig([]byte(raw), req.Name, req.Host, apiPort(req))
	if err != nil {
		return nil, err
	}
	if backup != "" {
		say("kubeconfig", "ok", "context %s added (previous file kept at %s)", req.Name, backup)
	} else {
		say("kubeconfig", "ok", "context %s added", req.Name)
	}

	say("runtime", "info", "installing tiny's runtime in namespace %s", req.Namespace)
	// The file just written, by path: it holds the new context whatever
	// KUBECONFIG says.
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath},
		&clientcmd.ConfigOverrides{CurrentContext: req.Name}).ClientConfig()
	if err != nil {
		return nil, err
	}
	rctx, rcancel := context.WithTimeout(ctx, 3*time.Minute)
	defer rcancel()
	// k3s ships kube-router, which programs a new pod's policy a moment
	// late; the fence wait closes that gap.
	if err := tinyruntime.Init(rctx, cfg, req.Namespace, tinyruntime.Options{EgressProxy: true, FenceWait: true}); err != nil {
		return nil, fmt.Errorf("install tiny runtime: %w", err)
	}
	say("runtime", "ok", "runtime installed, egress allow-list on")

	t := Target{Name: req.Name, Context: req.Name, Namespace: req.Namespace}
	if req.GVisor {
		// Installing gVisor protects nothing until sessions run under it.
		c, err := fleet.Connect(t.Context, t.Namespace)
		if err == nil {
			err = c.SandboxOn(rctx, "gvisor")
		}
		if err != nil {
			return nil, fmt.Errorf("turn the sandbox on: %w", err)
		}
		say("runtime", "ok", "sandbox on: every helper runs under gVisor")
	}
	if err := saveProfile(t); err != nil {
		say("runtime", "warn", "couldn't save the tiny profile (%v); the fleet still works here", err)
	}

	if req.CopyFrom != nil {
		say("credentials", "info", "copying agent credentials from %s", req.CopyFrom.Name)
		if err := a.copyCredentials(ctx, *req.CopyFrom, t); err != nil {
			say("credentials", "warn", "couldn't copy credentials: %v; run tiny setup against %s", err, req.Name)
		} else {
			say("credentials", "ok", "credentials copied")
		}
	} else if tok := strings.TrimSpace(req.Token); tok != "" {
		key, err := claudeKey(tok)
		if err == nil {
			var c *fleet.Client
			if c, err = fleet.Connect(t.Context, t.Namespace); err == nil {
				err = storeClaudeToken(ctx, c, key, tok)
			}
		}
		if err != nil {
			say("credentials", "warn", "couldn't sign helpers in: %v; add the key from Gardens", err)
		} else {
			say("credentials", "ok", "helpers signed in")
		}
	} else {
		say("credentials", "warn", "helpers aren't signed in yet: add a Claude key from Gardens")
	}
	a.mu.Lock()
	delete(a.stores, t.Context+"/"+t.Namespace)
	a.mu.Unlock()
	return &t, nil
}

// remote is one SSH connection that can run commands, with sudo when needed.
type remote struct {
	client   *ssh.Client
	user     string
	root     bool
	sudoPass string
	log      func(string)
}

func dialRemote(req InstallRequest, log func(string)) (*remote, error) {
	// One publickey method holding every key: the SSH client tries each
	// method name only once, so a second publickey method (agent keys,
	// then files) would never be offered. The named key goes first, before
	// the server's MaxAuthTries runs out on unrelated agent keys.
	var auths []ssh.AuthMethod
	var signers []ssh.Signer
	home, _ := os.UserHomeDir()
	keyFiles := []string{req.KeyFile, filepath.Join(home, ".ssh", "id_ed25519"), filepath.Join(home, ".ssh", "id_ecdsa"), filepath.Join(home, ".ssh", "id_rsa")}
	for _, f := range keyFiles {
		if f == "" {
			continue
		}
		b, err := os.ReadFile(expandHome(f))
		if err != nil {
			continue
		}
		if s, err := ssh.ParsePrivateKey(b); err == nil {
			signers = append(signers, s)
		} else if f == req.KeyFile {
			return nil, fmt.Errorf("key %s can't be used directly (%v); add it to your SSH agent with ssh-add", f, err)
		}
	}
	var agentKeys agent.ExtendedAgent
	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		if conn, err := net.Dial("unix", sock); err == nil {
			defer conn.Close()
			agentKeys = agent.NewClient(conn)
		}
	}
	if len(signers) > 0 || agentKeys != nil {
		auths = append(auths, ssh.PublicKeysCallback(func() ([]ssh.Signer, error) {
			all := append([]ssh.Signer(nil), signers...)
			if agentKeys != nil {
				if more, err := agentKeys.Signers(); err == nil {
					all = append(all, more...)
				}
			}
			return all, nil
		}))
	}
	if req.Password != "" {
		auths = append(auths, ssh.Password(req.Password))
	}
	if len(auths) == 0 {
		return nil, errors.New("no SSH key found: load one into your SSH agent (ssh-add) or name a key file")
	}
	hostKeys, err := hostKeyCallback(req.TrustFingerprint)
	if err != nil {
		return nil, err
	}
	c, err := ssh.Dial("tcp", net.JoinHostPort(req.Host, strconv.Itoa(req.Port)), &ssh.ClientConfig{
		User: req.User, Auth: auths, HostKeyCallback: hostKeys, Timeout: 15 * time.Second,
	})
	if err != nil {
		var uh UnknownHostError
		if errors.As(err, &uh) {
			return nil, uh
		}
		return nil, fmt.Errorf("ssh: %w", err)
	}
	return &remote{client: c, user: req.User, sudoPass: req.SudoPassword, log: log}, nil
}

// hostKeyCallback checks ~/.ssh/known_hosts. An unknown host is refused
// with its fingerprint, unless that fingerprint is the one the user
// confirmed, in which case it's added to known_hosts. A changed key is
// always refused.
func hostKeyCallback(trusted string) (ssh.HostKeyCallback, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(home, ".ssh", "known_hosts")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		_ = os.MkdirAll(filepath.Dir(path), 0o700)
		_ = os.WriteFile(path, nil, 0o600)
	}
	check, err := knownhosts.New(path)
	if err != nil {
		return nil, err
	}
	return func(hostname string, remoteAddr net.Addr, key ssh.PublicKey) error {
		err := check(hostname, remoteAddr, key)
		var ke *knownhosts.KeyError
		if errors.As(err, &ke) && len(ke.Want) == 0 {
			fp := ssh.FingerprintSHA256(key)
			if trusted != fp {
				return UnknownHostError{Fingerprint: fp}
			}
			line := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
			f, ferr := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
			if ferr != nil {
				return ferr
			}
			defer func() { _ = f.Close() }()
			_, ferr = f.WriteString(line + "\n")
			return ferr
		}
		if errors.As(err, &ke) {
			return fmt.Errorf("the host key for %s changed since it was saved in known_hosts; refusing to connect", hostname)
		}
		return err
	}, nil
}

func (r *remote) who() string {
	if r.root {
		return "as root"
	}
	return "as " + r.user + " with sudo"
}

func (r *remote) checkSudo() error {
	uid, err := r.out("id -u", false)
	if err != nil {
		return err
	}
	if uid == "0" {
		r.root = true
		return nil
	}
	if _, err := r.out("true", true); err != nil {
		if r.sudoPass == "" {
			return errors.New("sudo needs a password on that machine: enter it in the sudo field (used once, never stored)")
		}
		return fmt.Errorf("sudo refused: %w", err)
	}
	return nil
}

func (r *remote) wrap(cmd string, sudo bool) (string, io.Reader) {
	if !sudo || r.root {
		return "sh -c " + shellQuote(cmd), nil
	}
	if r.sudoPass == "" {
		return "sudo -n sh -c " + shellQuote(cmd), nil
	}
	return "sudo -S -p '' sh -c " + shellQuote(cmd), strings.NewReader(r.sudoPass + "\n")
}

// out runs a command and returns its trimmed output.
func (r *remote) out(cmd string, sudo bool) (string, error) {
	s, err := r.client.NewSession()
	if err != nil {
		return "", err
	}
	defer func() { _ = s.Close() }()
	full, stdin := r.wrap(cmd, sudo)
	s.Stdin = stdin
	var stdout, stderr bytes.Buffer
	s.Stdout, s.Stderr = &stdout, &stderr
	if err := s.Run(full); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		return "", fmt.Errorf("%s: %s", err, lastLines(msg, 6))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// stream runs a command and forwards its output, line by line, to the log.
// A failure carries the last lines, so the reason shows without the log.
func (r *remote) stream(cmd string, sudo bool) error {
	s, err := r.client.NewSession()
	if err != nil {
		return err
	}
	defer func() { _ = s.Close() }()
	full, stdin := r.wrap(cmd, sudo)
	s.Stdin = stdin
	pr, pw := io.Pipe()
	s.Stdout, s.Stderr = pw, pw
	done := make(chan struct{})
	var tail []string
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			if line := strings.TrimSpace(sc.Text()); line != "" {
				r.log(line)
				tail = append(tail, line)
				if len(tail) > 4 {
					tail = tail[1:]
				}
			}
		}
		close(done)
	}()
	err = s.Run(full)
	_ = pw.Close()
	<-done
	if err != nil && len(tail) > 0 {
		return fmt.Errorf("%w: %s", err, strings.Join(tail, " / "))
	}
	return err
}

func preflight(r *remote, say func(step, level, f string, args ...any)) error {
	freeKB, _ := r.out("df -Pk / | awk 'NR==2{print $4}'", false)
	memKB, _ := r.out("awk '/MemTotal/{print $2}' /proc/meminfo", false)
	cpus, _ := r.out("nproc", false)
	kernel, _ := r.out("uname -r", false)
	free, _ := strconv.Atoi(freeKB)
	mem, _ := strconv.Atoi(memKB)
	freeGB, memGB := free/1024/1024, mem/1024/1024
	say("preflight", "ok", "%d GB free disk, %d GB memory, %s CPUs, kernel %s", freeGB, memGB, cpus, kernel)
	// k3s stops scheduling pods below 15% free disk by default; a
	// workspace volume is several GB. This is the tinybox lesson.
	if freeGB < 20 {
		say("preflight", "warn", "only %d GB free on /: sessions may stop scheduling when the disk fills (Kubernetes refuses new pods under disk pressure)", freeGB)
	}
	if memGB < 2 {
		return fmt.Errorf("%d GB of memory is too little for k3s and an agent session; 4 GB or more is comfortable", memGB)
	}
	if have, _ := r.out("command -v curl || true", false); have == "" {
		return errors.New("curl isn't installed on that machine; install it (sudo apt install curl) and try again")
	}
	return nil
}

func waitNodeReady(ctx context.Context, r *remote) error {
	for i := 0; i < 60; i++ {
		out, _ := r.out("k3s kubectl get nodes --no-headers 2>/dev/null", true)
		if strings.Contains(out, " Ready") {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
	return errors.New("the k3s node didn't become ready within five minutes; check `sudo journalctl -u k3s` on the machine")
}

// installGVisor installs runsc from the pinned release, registers it with
// k3s's containerd and creates the gvisor RuntimeClass. Old kernels (the
// 5.4 on Ubuntu 20.04) need overlay2 off.
func installGVisor(ctx context.Context, r *remote, say func(step, level, f string, args ...any)) error {
	tmpl := "/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl"
	if existing, _ := r.out("cat "+tmpl+" 2>/dev/null || true", true); existing != "" {
		if strings.Contains(existing, "runsc") {
			say("gvisor", "ok", "gVisor is already registered with containerd")
			return ensureRuntimeClass(r)
		}
		return fmt.Errorf("%s already exists with other settings; not touching it", tmpl)
	}
	overlay := ""
	if kernel, _ := r.out("uname -r", false); kernelBefore(kernel, 5, 10) {
		overlay = `printf '%s\n' '[runsc_config]' '  overlay2 = "none"' > /etc/containerd/runsc.toml`
		say("gvisor", "info", "kernel %s is older than 5.10: turning off gVisor's overlay filesystem", kernel)
	}
	script := fmt.Sprintf(`set -e
# The release is a bzip2 tarball; minimal cloud images ship without bzip2.
if ! command -v bzip2 >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq bzip2
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q bzip2
  elif command -v yum >/dev/null 2>&1; then yum install -y -q bzip2
  else echo "bzip2 is missing and no known package manager is available"; exit 1; fi
fi
d=$(mktemp -d); cd "$d"
U=https://storage.googleapis.com/gvisor/releases/release/%s/$(uname -m)
curl -fsSLO "$U/gvisor.tar.bz2"; curl -fsSLO "$U/gvisor.tar.bz2.sha512"
sha512sum -c gvisor.tar.bz2.sha512
tar -xjf gvisor.tar.bz2 -C /usr/local/bin
/usr/local/bin/runsc --version | head -1
mkdir -p /etc/containerd
%s
{
  echo '{{ template "base" . }}'
  echo
  echo '[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]'
  echo '  runtime_type = "io.containerd.runsc.v1"'
  if [ -f /etc/containerd/runsc.toml ]; then
    echo
    echo '[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]'
    echo '  TypeUrl = "io.containerd.runsc.v1.options"'
    echo '  ConfigPath = "/etc/containerd/runsc.toml"'
  fi
} > %s
systemctl restart k3s
rm -rf "$d"`, gvisorRelease, overlay, tmpl)
	if err := r.stream(script, true); err != nil {
		return err
	}
	if err := waitNodeReady(ctx, r); err != nil {
		return err
	}
	if err := ensureRuntimeClass(r); err != nil {
		return err
	}
	say("gvisor", "ok", "gVisor ready: start sessions with --runtime-class gvisor")
	return nil
}

func ensureRuntimeClass(r *remote) error {
	_, err := r.out(`printf '%s\n' 'apiVersion: node.k8s.io/v1' 'kind: RuntimeClass' 'metadata:' '  name: gvisor' 'handler: runsc' | k3s kubectl apply -f -`, true)
	return err
}

func kernelBefore(release string, major, minor int) bool {
	m := regexp.MustCompile(`^(\d+)\.(\d+)`).FindStringSubmatch(release)
	if m == nil {
		return false
	}
	a, _ := strconv.Atoi(m[1])
	b, _ := strconv.Atoi(m[2])
	return a < major || (a == major && b < minor)
}

// mergeKubeconfig adds the k3s kubeconfig to ~/.kube/config under name,
// pointing at host instead of 127.0.0.1, and returns that file's path and
// where the previous version was copied. An existing context of that name
// is refused rather than overwritten, unless it's the same machine.
func mergeKubeconfig(k3s []byte, name, host string, port int) (path, backup string, err error) {
	src, err := clientcmd.Load(k3s)
	if err != nil {
		return "", "", fmt.Errorf("parse k3s kubeconfig: %w", err)
	}
	cluster, user, err := safeK3sEntries(src, host, port)
	if err != nil {
		return "", "", err
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", err
	}
	path = filepath.Join(home, ".kube", "config")
	dst := clientcmdapi.NewConfig()
	if b, rerr := os.ReadFile(path); rerr == nil {
		if dst, err = clientcmd.Load(b); err != nil {
			return "", "", fmt.Errorf("parse %s: %w", path, err)
		}
		if _, taken := dst.Contexts[name]; taken {
			if existing := dst.Clusters[dst.Contexts[name].Cluster]; existing != nil && existing.Server == cluster.Server {
				return path, "", nil // the same machine, added before
			}
			return "", "", fmt.Errorf("a context named %s already exists in %s; pick another name", name, path)
		}
		backup = fmt.Sprintf("%s.bak-%d", path, time.Now().Unix())
		if err := os.WriteFile(backup, b, 0o600); err != nil {
			return "", "", err
		}
	}
	dst.Clusters[name] = cluster
	dst.AuthInfos[name] = user
	dst.Contexts[name] = &clientcmdapi.Context{Cluster: name, AuthInfo: name}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", "", err
	}
	return path, backup, clientcmd.WriteToFile(*dst, path)
}

// safeK3sEntries builds the cluster and user entries from scratch with
// only what a k3s kubeconfig legitimately holds: the CA, and a client
// certificate and key (or a token). The file comes from the remote
// machine, and a kubeconfig can name a program to run for credentials
// (exec, auth-provider), a proxy, or skip TLS checks; copying it as is
// would let a compromised machine run code on this one. The server is
// set here, never taken from the file.
func safeK3sEntries(src *clientcmdapi.Config, host string, port int) (*clientcmdapi.Cluster, *clientcmdapi.AuthInfo, error) {
	c, u := src.Clusters["default"], src.AuthInfos["default"]
	if c == nil || u == nil {
		return nil, nil, errors.New("unexpected k3s kubeconfig: no default cluster or user")
	}
	if u.Exec != nil || u.AuthProvider != nil {
		return nil, nil, errors.New("the machine's kubeconfig asks to run a credential program; refusing to copy it")
	}
	if len(c.CertificateAuthorityData) == 0 {
		return nil, nil, errors.New("the machine's kubeconfig has no CA certificate; refusing to connect without verifying TLS")
	}
	if (len(u.ClientCertificateData) == 0 || len(u.ClientKeyData) == 0) && u.Token == "" {
		return nil, nil, errors.New("the machine's kubeconfig has no client certificate or token")
	}
	cluster := &clientcmdapi.Cluster{
		Server:                   "https://" + net.JoinHostPort(host, strconv.Itoa(port)),
		CertificateAuthorityData: c.CertificateAuthorityData,
	}
	user := &clientcmdapi.AuthInfo{
		ClientCertificateData: u.ClientCertificateData,
		ClientKeyData:         u.ClientKeyData,
		Token:                 u.Token,
	}
	return cluster, user, nil
}

// saveProfile records the fleet in the tiny CLI's config, so `tiny -p
// <name>` and this app's sidebar both find it. Other fields are kept.
func saveProfile(t Target) error {
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "tiny", "config.json")
	doc := map[string]any{}
	if b, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(b, &doc); err != nil {
			return fmt.Errorf("%s isn't valid JSON; not touching it", path)
		}
	}
	profiles, _ := doc["profiles"].(map[string]any)
	if profiles == nil {
		profiles = map[string]any{}
	}
	profiles[t.Name] = map[string]string{"context": t.Context, "namespace": t.Namespace}
	doc["profiles"] = profiles
	if _, ok := doc["context"]; !ok {
		doc["context"], doc["namespace"] = t.Context, t.Namespace
	}
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o600)
}

// copyCredentials copies tiny-agent-env from one fleet to another, the
// way `tiny setup` would store them, without the values passing through
// the window.
func (a *App) copyCredentials(ctx context.Context, from, to Target) error {
	src, err := a.store(from)
	if err != nil {
		return err
	}
	dst, err := fleet.Connect(to.Context, to.Namespace)
	if err != nil {
		return err
	}
	return fleet.CopyAgentCredentials(ctx, src, dst)
}

func apiPort(req InstallRequest) int {
	if req.APIPort == 0 {
		return 6443
	}
	return req.APIPort
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

func lastLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, " / ")
}
