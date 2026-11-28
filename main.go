// Tiny Systems is the desktop app for tiny: one window to watch every
// fleet of coding agents, step into any session's terminal, and (soon)
// install and look after the machines they run on.
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

// version is set at build time: -ldflags "-X main.version=0.1.0".
var version = "dev"

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:            "Tiny Systems",
		Width:            1280,
		Height:           820,
		MinWidth:         900,
		MinHeight:        560,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 14, G: 15, B: 17, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		// Closing the window keeps the app running, so helpers can still
		// reach you; the Dock icon brings it back, Cmd+Q quits.
		HideWindowOnClose: true,
		Bind:              []interface{}{app},
		// Files dropped on the conversation go to the helper; the webview
		// itself never opens a dropped file.
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true, DisableWebViewDrop: true},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			WebviewIsTransparent: false,
			About: &mac.AboutInfo{
				Title:   "Tiny Systems",
				Message: "Coding agents on your own machines.\ntinysystems.io",
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
