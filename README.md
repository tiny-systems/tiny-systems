# Tiny Systems

The desktop app for [tiny](https://github.com/tiny-systems/tiny): one window
to watch every fleet of coding agents, step into any session's terminal, and
look after the machines they run on.

Each fleet is a greenhouse and each session a potted seedling. You read its
state from the plant:

| plant | session |
|---|---|
| a seed in the soil | starting |
| two leaves, swaying | working |
| an amber bud | waiting for you |
| in flower | finished |
| wilted | failed |
| greyed out | paused |

## What it does today

- **Every fleet you've saved with the tiny CLI** (`tiny profile save`) appears
  in the sidebar, with how many sessions are running and how many need you.
- **Answer questions** right in the list, pause, resume and delete sessions,
  and start new ones.
- **Attach** opens the session's tmux in a tab, the same connection
  `tiny attach` uses. Close the tab to detach; the agent keeps running.

It uses your kubeconfig and acts with your own credentials, exactly like the
CLI. It reads `~/.kube/config`, plus any files named in `KUBECONFIG`.

## Coming

- **Install on a computer on your network:** give it an address and SSH
  access, and it sets up k3s (and gVisor, optionally) and connects tiny.
- **Install on this Mac**, in a small Linux VM.
- **Maintenance:** runtime upgrades, expiring tokens, a disk filling up before
  pods stop scheduling, and notifications when an agent needs you.

## Build

Needs Go 1.26, Node 22 and [Wails](https://wails.io) v2.

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.11.0
wails build -ldflags "-X main.version=0.1.0"
open "build/bin/Tiny Systems.app"
```

`wails dev` runs it with live reload. The app is built on tiny's public
[`pkg/fleet`](https://pkg.go.dev/github.com/tiny-systems/tiny/pkg/fleet)
package; nothing here talks to the cluster in a way the CLI doesn't.

macOS only for now. The machines it installs onto can be Linux or macOS.

MIT licensed. © 2026 Tiny Systems Limited.
