# Changelog

## 0.1.4

- Helpers can show you files: a screenshot of what they built, a chart,
  a report. They appear in the conversation with a caption, images
  inline (click for full size); **Save…** keeps a copy. The file stays
  on the helper's computer until you look at it. Needs tiny 0.19: gardens
  on an older runtime show **Upgrade runtime**.

## 0.1.3

- A starting helper shows what it's waiting on (a machine, the first
  download of the helper image, the workspace) in its chat and terminal,
  and the terminal connects by itself once the helper runs, instead of
  failing with "does not have a host assigned".
- Each garden in the helper list has its own + (on hover), and an empty
  garden offers **Start a helper**.

## 0.1.2

- New helpers start again: the app asked for a helper image tagged with
  its own version (0.1.x), which doesn't exist, so helpers stayed in
  Starting. It now asks for the engine's version.
- Updates install themselves (Sparkle): once a day, or **Check for
  updates…** in the ? menu; Settings can let them install when the app
  quits.
- Dialogs close with a click outside them, Esc or Cancel, and ask before
  throwing away anything you typed.

## 0.1.1

- Quieter, livelier motion: buttons press in, icons grow a touch on hover,
  new helpers and messages rise in, a helper that changes state flashes
  once, working text shimmers. Off when macOS Reduce motion is on.
- Looping animations no longer restart every time the list refreshes.
- The disk image opens on a garden background with an arrow to
  Applications.
- Homebrew: `brew install --cask tiny-systems/tap/tiny-systems`.

## 0.1.0

The first public release.

- Helpers: start one with a task or none, answer its questions, send it
  messages, watch it in its terminal, let it rest, remove it.
- Gardens on this Mac (Lima comes inside the app; no folders shared into
  the VM) or on another computer over SSH, with k3s, the gVisor sandbox and
  the egress allow-list set up for you.
- Sign helpers in by pasting a Claude key, or copy the sign-in from
  another garden.
- Health with the fix beside it: start a stopped VM, upgrade the runtime,
  turn the sandbox on.
- Notifications and a Dock badge when a helper needs you; the app keeps
  running with its window closed.
- Settings: open at login, start this Mac's gardens with the app, update
  checks. Copy diagnostics for support.
- Signed and notarized, for macOS 13 or later on Apple silicon and Intel.
