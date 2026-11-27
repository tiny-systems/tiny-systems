package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

// The Secret and keys `tiny setup` stores Claude's sign-in under.
const (
	agentEnvSecret = "tiny-agent-env"
	keyOAuth       = "CLAUDE_CODE_OAUTH_TOKEN"
	keyAPIKey      = "ANTHROPIC_API_KEY"
)

// claudeKey says which kind of Claude credential a pasted value is: a
// subscription token from `claude setup-token`, or an API key from the
// Claude Console. Anything else is refused before it's stored.
func claudeKey(token string) (string, error) {
	switch {
	case strings.ContainsAny(token, " \t\r\n"):
		return "", errors.New("that has spaces or line breaks in it: paste just the key")
	case strings.HasPrefix(token, "sk-ant-oat"):
		return keyOAuth, nil
	case strings.HasPrefix(token, "sk-ant-api"):
		return keyAPIKey, nil
	case token == "":
		return "", errors.New("paste a Claude key first")
	default:
		return "", errors.New("that doesn't look like a Claude key: it should start with sk-ant-")
	}
}

// withClaudeToken returns the Secret's data with the Claude credential set
// to token and the other kind removed, so an old API key can't outrank a
// new subscription token. Codex and anything else stored there are kept.
func withClaudeToken(data map[string][]byte, key, token string) map[string][]byte {
	out := map[string][]byte{}
	for k, v := range data {
		if k != keyOAuth && k != keyAPIKey {
			out[k] = v
		}
	}
	out[key] = []byte(token)
	return out
}

// SignIn stores a pasted Claude key in a garden, where helpers pick it up
// when they start. It goes where `tiny setup` would put it: into the
// model gateway when that's on (so it never reaches a helper's pod), else
// into tiny-agent-env. The key is never logged or returned.
func (a *App) SignIn(t Target, token string) error {
	token = strings.TrimSpace(token)
	key, err := claudeKey(token)
	if err != nil {
		return err
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error { return storeClaudeToken(ctx, c, key, token) })
}

func storeClaudeToken(ctx context.Context, c *fleet.Client, key, token string) error {
	if f, err := c.FederationState(ctx); err == nil && f.On() {
		return errors.New("this garden signs helpers in through Claude Console federation: no key is needed")
	}
	if kind, err := c.GatewayState(ctx); err == nil && kind != "" {
		return c.StoreGatewayCredential(ctx, key, token)
	}
	k := c.Kube
	s := &corev1.Secret{}
	err := k.Client.Get(ctx, client.ObjectKey{Namespace: k.Namespace, Name: agentEnvSecret}, s)
	switch {
	case apierrors.IsNotFound(err):
		s = &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Namespace: k.Namespace, Name: agentEnvSecret},
			Data:       withClaudeToken(nil, key, token),
		}
		return k.Client.Create(ctx, s)
	case err != nil:
		return err
	}
	s.Data = withClaudeToken(s.Data, key, token)
	s.StringData = nil
	return k.Client.Update(ctx, s)
}

// HasClaudeCLI says whether Claude Code is installed on this Mac, so the
// window can offer `claude setup-token` for a subscription key.
func (a *App) HasClaudeCLI() bool { _, err := claudeCLI(); return err == nil }

// ClaudeSetupToken opens Terminal running `claude setup-token`: it signs in
// with the person's Claude account in the browser and prints a key to
// paste back into the window. The app never sees their password.
func (a *App) ClaudeSetupToken() error {
	bin, err := claudeCLI()
	if err != nil {
		return err
	}
	script := `on run argv
tell application "Terminal"
	activate
	do script (quoted form of (item 1 of argv)) & " setup-token"
end tell
end run`
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "osascript", "-e", script, bin).Run()
}

// claudeCLI finds Claude Code's command. Apps opened from Finder don't get
// the shell's PATH, so the usual install places are tried by name.
func claudeCLI() (string, error) {
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{
		filepath.Join(home, ".local", "bin", "claude"),
		filepath.Join(home, ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude", "/usr/local/bin/claude",
	} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	return "", errors.New("Claude Code isn't installed on this Mac")
}
