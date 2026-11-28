# Changelog

## 0.1.6

- Helpers a helper started sit indented under it, with a count you can
  click to fold them away; a child's header says who started it.
- **Message several helpers** (the envelope by the search box): tick the
  helpers, across gardens, and send them one message.
- **Send to another helper…** (the ••• menu): pass a note, and a file
  from this helper's workspace if you like, to another helper.
- New helper can start from a **folder on this Mac**, sent as it is with
  uncommitted changes, and can **continue its Claude Code conversation**
  there (tiny's handoff). The helper's startup shows the folder going up.
- **Export conversation…** saves a helper's conversation as Markdown.
- A resting helper says that messages wait in its inbox until you resume
  it, with a Resume button right there.
- The "Start a helper" line under an empty garden is gone; its + stays
  visible instead.

## 0.1.5

- **Changes** tab: what the helper changed in its project, read live from
  its workspace. Files on the left (a filled dot means committed on its
  branch), each one's diff on the right. **Pull…** copies the project,
  with its history and uncommitted work, into a new folder on this Mac.
- **Shell** tab: a plain shell on the helper's files, beside the agent.
  For a paused or finished helper it starts a short-lived pod on the same
  workspace and removes it when the shell closes.
- Send files to a helper: drop them on the conversation or press the
  paper clip. They land in `/workspace/uploads` and the helper is told.
- Permission requests say what they do ("Open port 5173") and list every
  detail Allow will use, with a warning when a helper asks for its own
  container image or user; after you allow, the result shows (a link
  opens in the browser).
- Pull never copies the helper's `.git` (git would run its hooks and
  settings on this Mac): the history is rebuilt in the new folder from a
  bundle, with uncommitted work showing as changes. Needs git on this Mac
  for the history; without it the files come alone.
- New helper → Advanced: CPUs, memory and sandbox (garden default,
  gVisor, or none).
- Saving a file a helper showed you no longer keeps a name that could run
  when opened: anything but plain images, PDFs and text gets `.download`.

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
