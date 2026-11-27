package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// releasesAPI is where the app looks for a newer version; a var so tests
// can point it at a local server.
var releasesAPI = "https://api.github.com/repos/tiny-systems/tiny-systems/releases/latest"

// Update says whether a newer release is out and where to get it.
type Update struct {
	Available bool   `json:"available"`
	Version   string `json:"version,omitempty"` // "0.2.0"
	URL       string `json:"url,omitempty"`     // the release's .dmg, or its page
	Notes     string `json:"notes,omitempty"`   // the release page, for "What's new"
}

// CheckUpdate asks GitHub for the latest release, for builds without
// Sparkle (0.1.0 and 0.1.1, development builds): the window offers the
// download and the person decides. A release with Sparkle reports nothing
// here, since Sparkle checks and installs updates itself.
func (a *App) CheckUpdate() Update {
	if sparkle || !loadSettings().CheckUpdates { // Sparkle has its own notice
		return Update{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	u, err := checkUpdate(ctx, version)
	if err != nil {
		return Update{}
	}
	return u
}

func checkUpdate(ctx context.Context, current string) (Update, error) {
	cur, ok := parseVersion(current)
	if !ok {
		return Update{}, nil // a dev build has nothing to compare
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesAPI, nil)
	if err != nil {
		return Update{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "TinySystems/"+current)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return Update{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return Update{}, fmt.Errorf("releases: %s", resp.Status)
	}
	var rel struct {
		Tag        string `json:"tag_name"`
		HTMLURL    string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return Update{}, err
	}
	latest, ok := parseVersion(rel.Tag)
	if !ok || rel.Draft || rel.Prerelease || !newer(latest, cur) {
		return Update{}, nil
	}
	u := Update{Available: true, Version: strings.TrimPrefix(rel.Tag, "v"), URL: rel.HTMLURL, Notes: rel.HTMLURL}
	for _, a := range rel.Assets {
		if strings.HasSuffix(a.Name, ".dmg") && strings.HasPrefix(a.URL, "https://github.com/") {
			u.URL = a.URL
			break
		}
	}
	if !strings.HasPrefix(u.URL, "https://github.com/") {
		return Update{}, nil // only ever offer a GitHub link
	}
	return u, nil
}

// parseVersion reads "v1.2.3" or "1.2.3"; anything else (dev, a
// pre-release suffix) isn't a version to compare.
func parseVersion(s string) ([3]int, bool) {
	var v [3]int
	parts := strings.Split(strings.TrimPrefix(s, "v"), ".")
	if len(parts) != 3 {
		return v, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return v, false
		}
		v[i] = n
	}
	return v, true
}

func newer(a, b [3]int) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
