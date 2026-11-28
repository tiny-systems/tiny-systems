package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

// GardenSettings is what the garden settings sheet shows: the garden's
// internet access and how its helpers sign in to Claude. It never holds a
// key, only where the key is kept.
type GardenSettings struct {
	Egress fleet.Egress `json:"egress"`
	// Refused is what the allow-list turned away lately, most frequent
	// first; empty when the allow-list is off.
	Refused []fleet.Refusal `json:"refused"`
	Model   ModelKey        `json:"model"`
}

// ModelKey says where a garden keeps its Claude sign-in.
type ModelKey struct {
	// Mode is fleet.Health's SignIn: "stored" (in every helper),
	// "gateway" (in the allow-list proxy only), "federation" (no key at
	// all) or "none".
	Mode string `json:"mode"`
	// Kind is the gateway's credential kind, "oauth" or "apikey".
	Kind       string         `json:"kind,omitempty"`
	Federation FederationInfo `json:"federation"`
	// Leftover means federation is on but a key is still stored in the
	// garden, unused, where helpers could read it.
	Leftover bool `json:"leftover"`
}

// FederationInfo is the Claude Console federation rule a garden uses. The
// IDs are not secrets.
type FederationInfo struct {
	Rule           string `json:"rule"`
	Organization   string `json:"organization"`
	ServiceAccount string `json:"serviceAccount"`
	Workspace      string `json:"workspace"`
}

// refusalLines is how much of the proxy's log the sheet reads.
const refusalLines = 2000

// GardenSettings reads a garden's internet access and sign-in.
func (a *App) GardenSettings(t Target) (GardenSettings, error) {
	if isDemo(t) {
		return demoGardenSettings(), nil
	}
	var out GardenSettings
	err := a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		eg, err := c.EgressState(ctx)
		if err != nil {
			return err
		}
		out.Egress = eg
		if eg.Mode == fleet.EgressAllowList {
			// A proxy still starting has no log yet: that is no refusals,
			// not an error worth showing.
			if r, err := c.Refusals(ctx, refusalLines); err == nil {
				out.Refused = r
			} else if !errors.Is(err, fleet.ErrNoProxy) {
				return err
			}
		}
		h, err := c.Health(ctx)
		if err != nil {
			return err
		}
		out.Model.Mode = h.SignIn
		if out.Model.Kind, err = c.GatewayState(ctx); err != nil {
			return err
		}
		f, err := c.FederationState(ctx)
		if err != nil {
			return err
		}
		if f.On() {
			out.Model.Federation = FederationInfo{Rule: f.RuleID, Organization: f.OrganizationID, ServiceAccount: f.ServiceAccountID, Workspace: f.WorkspaceID}
			left, err := c.ClaudeCredentialInAgentEnv(ctx)
			if err != nil {
				return err
			}
			out.Model.Leftover = left != ""
		}
		return nil
	})
	if out.Refused == nil {
		out.Refused = []fleet.Refusal{}
	}
	return out, err
}

// SetEgressMode switches what a garden's helpers may reach: "open",
// "fenced" (web ports only) or "allowlist" (only the listed sites).
func (a *App) SetEgressMode(t Target, mode string) error {
	if isDemo(t) {
		return errNotInDemo
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error { return c.SetEgressMode(ctx, mode) })
}

// AllowHost adds a site to a garden's allow-list.
func (a *App) AllowHost(t Target, host string) error {
	if isDemo(t) {
		return errNotInDemo
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		_, err := c.AllowHost(ctx, host)
		return err
	})
}

// RemoveHost takes a site off a garden's allow-list.
func (a *App) RemoveHost(t Target, host string) error {
	if isDemo(t) {
		return errNotInDemo
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		_, err := c.RemoveHost(ctx, host)
		return err
	})
}

// SetGateway moves the garden's Claude key out of every helper and into
// the allow-list proxy, which adds it to model requests on the way out;
// off puts it back. Helpers already running keep what they started with.
func (a *App) SetGateway(t Target, on bool) error {
	if isDemo(t) {
		return errNotInDemo
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		if on {
			_, err := c.GatewayOn(ctx)
			return err
		}
		return c.GatewayOff(ctx)
	})
}

// SetFederation signs the garden's helpers in through a Claude Console
// federation rule: no key is stored at all.
func (a *App) SetFederation(t Target, f FederationInfo) error {
	if isDemo(t) {
		return errNotInDemo
	}
	trim := strings.TrimSpace
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		return c.SetFederation(ctx, fleet.Federation{
			RuleID: trim(f.Rule), OrganizationID: trim(f.Organization),
			ServiceAccountID: trim(f.ServiceAccount), WorkspaceID: trim(f.Workspace),
		})
	})
}

// ClearFederation turns federation off; helpers use a stored key again.
func (a *App) ClearFederation(t Target) error {
	if isDemo(t) {
		return errNotInDemo
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error { return c.ClearFederation(ctx) })
}

// RemoveStoredKey deletes the Claude key a federated garden no longer
// needs. Only allowed while federation is on, so helpers can still sign in.
func (a *App) RemoveStoredKey(t Target) error {
	if isDemo(t) {
		return errNotInDemo
	}
	return a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		f, err := c.FederationState(ctx)
		if err != nil {
			return err
		}
		if !f.On() {
			return errors.New("helpers here sign in with this key: set up federation first")
		}
		return c.RemoveClaudeCredential(ctx)
	})
}

// Preset is a saved set of New helper choices.
type Preset struct {
	Name    string `json:"name"`
	Repo    string `json:"repo,omitempty"`
	Agent   string `json:"agent,omitempty"`
	Model   string `json:"model,omitempty"`
	Image   string `json:"image,omitempty"`
	CPU     string `json:"cpu,omitempty"`
	Memory  string `json:"memory,omitempty"`
	Sandbox string `json:"sandbox,omitempty"`
}

func presetsPath() string { return filepath.Join(appDir(), "presets.json") }

// Presets lists the saved presets, by name.
func (a *App) Presets() []Preset {
	var out []Preset
	if b, err := os.ReadFile(presetsPath()); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	slices.SortFunc(out, func(x, y Preset) int { return strings.Compare(strings.ToLower(x.Name), strings.ToLower(y.Name)) })
	if out == nil {
		out = []Preset{}
	}
	return out
}

// SavePreset stores a preset, replacing one with the same name.
func (a *App) SavePreset(p Preset) error {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return errors.New("give the preset a name")
	}
	if len(p.Name) > 60 {
		return errors.New("keep the preset name under 60 characters")
	}
	list := slices.DeleteFunc(a.Presets(), func(x Preset) bool { return strings.EqualFold(x.Name, p.Name) })
	return writePresets(append(list, p))
}

// DeletePreset removes a preset by name.
func (a *App) DeletePreset(name string) error {
	return writePresets(slices.DeleteFunc(a.Presets(), func(x Preset) bool { return strings.EqualFold(x.Name, name) }))
}

func writePresets(list []Preset) error {
	b, _ := json.MarshalIndent(list, "", "  ")
	if err := os.MkdirAll(appDir(), 0o700); err != nil {
		return err
	}
	tmp := presetsPath() + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, presetsPath())
}

func demoGardenSettings() GardenSettings {
	now := time.Now()
	return GardenSettings{
		Egress: fleet.Egress{
			Mode: fleet.EgressAllowList, Enforced: "enforced by Calico", Proxy: "running",
			Hosts: []string{"api.anthropic.com", "github.com", ".githubusercontent.com", ".npmjs.org", "pypi.org", "files.pythonhosted.org"},
		},
		Refused: []fleet.Refusal{
			{Host: "registry.yarnpkg.com", Count: 6, Last: now.Add(-4 * time.Minute)},
			{Host: "telemetry.example.dev", Count: 2, Last: now.Add(-31 * time.Minute)},
		},
		Model: ModelKey{Mode: fleet.SignInGateway, Kind: "oauth"},
	}
}
