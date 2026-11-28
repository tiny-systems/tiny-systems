package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	agentsv1 "github.com/tiny-systems/tiny/api/v1alpha1"
	"github.com/tiny-systems/tiny/pkg/fleet"
)

// maxShown caps what the app pulls out of a pod for one file.
const maxShown = 25 << 20

// ShownFile is a file a helper showed you, read from its pod.
type ShownFile struct {
	Name string `json:"name"`
	Type string `json:"type"` // MIME type
	Data string `json:"data"` // base64
	Size int    `json:"size"`
}

// readShown reads a file the helper recorded with show_user. Only paths
// the session's status lists can be read: the window can't be talked into
// fetching anything else from the pod.
func (a *App) readShown(t Target, session, file string) ([]byte, error) {
	var data []byte
	err := a.withStore(t, func(ctx context.Context, c *fleet.Client) error {
		se := &agentsv1.Session{}
		if err := c.Kube.Client.Get(ctx, client.ObjectKey{Namespace: c.Kube.Namespace, Name: session}, se); err != nil {
			return err
		}
		listed := false
		for _, f := range se.Status.Shown {
			listed = listed || f.Path == file
		}
		if !listed {
			return fmt.Errorf("%s didn't show %s", session, file)
		}
		snap, err := c.Load(ctx)
		if err != nil {
			return err
		}
		pod := ""
		for _, r := range snap.Rows {
			if r.Name == session && r.Phase == "Running" {
				pod = r.Pod
			}
		}
		if pod == "" {
			return errors.New("the helper isn't running; wake it to open its files")
		}
		data, err = c.ReadFile(ctx, pod, file, maxShown)
		return err
	})
	return data, err
}

// ReadShown returns a shown file for display.
func (a *App) ReadShown(t Target, session, file string) (ShownFile, error) {
	if isDemo(t) {
		return demoShown(file)
	}
	data, err := a.readShown(t, session, file)
	if err != nil {
		return ShownFile{}, err
	}
	return ShownFile{Name: path.Base(file), Type: mimeOf(file, data), Data: base64.StdEncoding.EncodeToString(data), Size: len(data)}, nil
}

// SaveShown asks where to save a shown file and writes it there. It
// returns the path it saved to, or "" when you cancelled.
func (a *App) SaveShown(t Target, session, file string) (string, error) {
	var data []byte
	var err error
	if isDemo(t) {
		f, derr := demoShown(file)
		if derr != nil {
			return "", derr
		}
		data, err = base64.StdEncoding.DecodeString(f.Data)
	} else {
		data, err = a.readShown(t, session, file)
	}
	if err != nil {
		return "", err
	}
	home, _ := os.UserHomeDir()
	dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename:  path.Base(file),
		DefaultDirectory: home + "/Downloads",
		Title:            "Save " + path.Base(file),
	})
	if err != nil || dest == "" {
		return "", err
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}

// mimeOf names a file's type from its bytes, with the extension for what
// sniffing can't tell (SVG reads as text).
func mimeOf(name string, data []byte) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".svg":
		return "image/svg+xml"
	case ".md", ".markdown":
		return "text/markdown; charset=utf-8"
	}
	return http.DetectContentType(data)
}

