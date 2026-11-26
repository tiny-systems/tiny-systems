# Tiny Systems

The desktop app for [tiny](https://github.com/tiny-systems/tiny): one window
to watch every fleet of coding agents, step into any session's terminal, and
look after the machines they run on.

Your helpers live in gardens. A garden is a computer they work on: this
Mac, or another one at home or in the office. Each helper is a plant in the
garden's planter, and you can tell how it's doing at a glance:

| plant | helper |
|---|---|
| a seed in the soil | getting ready |
| leaves swaying | working |
| an amber bud, saying "Needs you" | waiting for your answer |
| in flower | finished |
| wilted | stuck |
| asleep | resting |

Click a plant to see what it's doing, answer it, watch it work, let it rest
or send it home.

`TINY_DEMO=1` adds a demo garden with a helper in every state, for trying
the look without a cluster (`TINY_DEMO_SELECT=s-fern` opens one).

## What it does today

- **Every fleet you've saved with the tiny CLI** (`tiny profile save`) appears
  in the sidebar, with how many sessions are running and how many need you.
- **Answer questions** right in the list, pause, resume and delete sessions,
  and start new ones.
- **Attach** opens the session's tmux in a tab, the same connection
  `tiny attach` uses. Close the tab to detach; the agent keeps running.

It uses your kubeconfig and acts with your own credentials, exactly like the
CLI. It reads `~/.kube/config`, plus any files named in `KUBECONFIG`.

- **Add a machine:** give it a Linux computer's address and SSH access. It
  checks the machine (warning when the disk is small), installs k3s and,
  optionally, gVisor, adds the cluster to `~/.kube/config` (keeping a backup),
  installs tiny's runtime with the egress allow-list on, saves a tiny
  profile, and can copy agent credentials from another fleet. Your SSH agent
  and `~/.ssh` keys are used; an unknown host key is shown for you to confirm
  before anything runs; a sudo password, when one is needed, is used once and
  never stored. Running it again on the same machine keeps what's there.

- **Or on this Mac:** the same installer, onto an Ubuntu VM it creates with
  [Lima](https://lima-vm.io) (`brew install lima`). Several can run side by
  side; each gets its own Kubernetes API port. Lima VMs don't start with the
  Mac, so a stopped one shows a **Start VM** button.
- **Health, with the fix beside it:** a node out of disk (Kubernetes stops
  starting pods) or under 20% free, memory pressure, a runtime older than the
  app (**Upgrade runtime**), and no agent credentials (**Copy** from another
  fleet).
- **Notifications** when an agent starts waiting for you.

## Testing the installer

`go test -tags lima -run TestInstallOnLima -v -timeout 30m .` runs the real
installer against a [Lima](https://lima-vm.io) VM, with a temporary home
folder so your kubeconfig and known_hosts aren't touched:

```sh
limactl start --name tiny-ssh-test --cpus 2 --memory 4 --disk 30 template://ubuntu-lts
go test -count=1 -tags lima -run TestInstallOnLima -v -timeout 30m .
```

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
