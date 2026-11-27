# Tiny Systems

Claude Code and Codex helpers that work on your own computers. You give a
helper a task; it works through it, asks when it needs your call, and never
holds your keys. This is the Mac app. The engine underneath is
[tiny](https://github.com/tiny-systems/tiny).

**[Download for macOS](https://github.com/tiny-systems/tiny-systems/releases/latest/download/Tiny-Systems.dmg)**
(macOS 13 or later, Apple silicon or Intel). Open the disk image and drag
Tiny Systems to Applications. More at [tinysystems.io](https://tinysystems.io).

## How it works

Helpers live in **gardens**. A garden is a computer they work on: a small
virtual machine on this Mac, or another computer at home or in the office.
Each helper runs in its own container on that computer (inside the gVisor
sandbox when the garden has it), with outbound traffic limited to an
allow-list.

The window has three parts: the rail (Helpers, Gardens), the list of
helpers with what each is doing, and the conversation with the one you
picked.

- **Helpers.** Start one with a task, or with none and talk to it. Each row
  shows its state: working, needs you, finished, stuck, resting. Answer a
  question right in the conversation, send a message, open its terminal to
  watch it work (closing the terminal leaves it running), let it rest, or
  remove it.
- **Gardens.** Add a garden on this Mac or on another computer, see how
  each one is doing (disk, memory, runtime version, sign-in), with the fix
  beside what's wrong: start a stopped VM, upgrade the runtime, copy the
  sign-in from another garden, turn the sandbox on.
- **Notifications** when a helper starts waiting for you, and the count on
  the Dock icon. Closing the window keeps the app running so helpers can
  still reach you; click the Dock icon to bring it back, ⌘Q to quit.
- **Settings** (the ? button): open at login, start this Mac's gardens
  when the app opens, update checks. **Copy diagnostics** puts a report
  for support on the clipboard: versions, VMs, each garden's health and
  the end of the log (`~/Library/Logs/Tiny Systems/app.log`). It holds no
  keys.
- **Updates.** The app checks GitHub for a newer release a few times a day
  and offers a Download button. It never installs anything by itself.

## Adding a garden

**On this Mac:** the app creates an Ubuntu VM with [Lima](https://lima-vm.io),
which comes inside the app, and sets everything up in it. No folders from
your Mac are shared into the VM. Several can run side by side. VMs don't
start with the Mac, so a stopped one shows **Start VM**.

**On another computer:** give it a Linux computer's address and SSH access.
The app checks the machine (warning when the disk is small), installs k3s
and the gVisor sandbox, adds the cluster to `~/.kube/config` (keeping a
backup), installs tiny's runtime with the egress allow-list on, and signs
helpers in: with a Claude key you paste (a `claude setup-token` from a
Claude subscription, or a Console API key), or the sign-in of another
garden. The key goes straight into the garden, into the model gateway when
that's on; the app never logs it.

What it's careful about:

- Your SSH agent and `~/.ssh` keys are used. An unknown host key is shown
  for you to confirm before anything runs; a changed one is refused.
- A sudo password, when one is needed, is used once and never stored.
- The machine's kubeconfig is rebuilt from only the CA and client
  certificate. A kubeconfig that asks to run a program, skips TLS checks
  or names a proxy is never copied to this Mac.
- Running it again on the same machine keeps what's there.

## For developers

The app uses your kubeconfig and acts with your own credentials, exactly
like the tiny CLI, through tiny's public
[`pkg/fleet`](https://pkg.go.dev/github.com/tiny-systems/tiny/pkg/fleet)
package. Gardens are tiny CLI profiles (`tiny profile save`). It reads
`~/.kube/config` plus any files named in `KUBECONFIG`.

Build (Go 1.26, Node 22, [Wails](https://wails.io) v2.11):

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.11.0
wails build -ldflags "-X main.version=0.1.0"
open "build/bin/Tiny Systems.app"
```

A development build uses a Homebrew Lima (`brew install lima`); release
builds bundle Lima with `scripts/fetch-lima.sh`, pinned by checksum, and
sign `limactl` separately with the virtualization entitlement
(`build/darwin/lima.entitlements`).

`wails dev` runs it with live reload. `TINY_DEMO=1` adds a demo garden with
a helper in every state, for working on the look without a cluster
(`TINY_DEMO_SELECT=s-fern` opens one). `npm run build:web` in `frontend/`
builds the same UI for the browser with a stand-in backend
(`frontend/web/shim.js`); `scripts/web-demo.sh` copies it into the website.

Tests: `go test -race ./...` runs on every push. The installer tests run
the real installer against [Lima](https://lima-vm.io) VMs with a temporary
home folder, so your kubeconfig and known_hosts aren't touched:

```sh
limactl start --name tiny-ssh-test --cpus 2 --memory 4 --disk 30 template://ubuntu-lts
go test -count=1 -tags lima -run TestInstallOnLima -v -timeout 30m .
```

Releases: push a `v*` tag. `.github/workflows/release.yml` builds a
universal app, signs it with the Developer ID certificate, notarizes and
staples it, and attaches `Tiny-Systems-<version>.dmg`, `Tiny-Systems.dmg`
and `SHA256SUMS` to the GitHub release. Signing secrets live on the
`release` environment; `scripts/signing-secrets.sh` sets them up.

MIT.
