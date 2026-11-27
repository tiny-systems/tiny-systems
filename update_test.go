package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func releaseServer(t *testing.T, body string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, body) }))
	t.Cleanup(srv.Close)
	old := releasesAPI
	releasesAPI = srv.URL
	t.Cleanup(func() { releasesAPI = old })
}

const release = `{"tag_name":"v0.3.0","html_url":"https://github.com/tiny-systems/tiny-systems/releases/tag/v0.3.0",
 "assets":[{"name":"Tiny-Systems-0.3.0.dmg","browser_download_url":"https://github.com/tiny-systems/tiny-systems/releases/download/v0.3.0/Tiny-Systems-0.3.0.dmg"}]}`

func TestCheckUpdateNewer(t *testing.T) {
	releaseServer(t, release)
	u, err := checkUpdate(t.Context(), "0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	if !u.Available || u.Version != "0.3.0" || u.URL != "https://github.com/tiny-systems/tiny-systems/releases/download/v0.3.0/Tiny-Systems-0.3.0.dmg" {
		t.Fatalf("got %+v", u)
	}
}

func TestCheckUpdateNothingNew(t *testing.T) {
	releaseServer(t, release)
	for _, cur := range []string{"0.3.0", "v0.3.0", "0.10.0", "1.0.0", "dev", "web demo"} {
		u, err := checkUpdate(t.Context(), cur)
		if err != nil || u.Available {
			t.Fatalf("%s: got %+v %v", cur, u, err)
		}
	}
}

func TestCheckUpdateIgnoresOddReleases(t *testing.T) {
	for _, body := range []string{
		`{"tag_name":"v0.4.0","prerelease":true,"html_url":"https://github.com/x"}`,
		`{"tag_name":"v0.4.0-rc1","html_url":"https://github.com/x"}`,
		`{"tag_name":"v0.4.0","html_url":"https://evil.example/x"}`, // only GitHub links
	} {
		releaseServer(t, body)
		if u, _ := checkUpdate(t.Context(), "0.3.0"); u.Available {
			t.Fatalf("%s: offered %+v", body, u)
		}
	}
}

func TestNewer(t *testing.T) {
	a, _ := parseVersion("0.10.0")
	b, _ := parseVersion("0.9.9")
	if !newer(a, b) || newer(b, a) || newer(a, a) {
		t.Fatal("version order")
	}
}
