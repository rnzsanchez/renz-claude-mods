# renz-claude-mods

Small mods for [Claude Code](https://claude.com/claude-code), built because a few things kept bugging me. Each one is a tiny plugin of function hooks: no servers, no background daemons, nothing to babysit.

| Mod | In one line |
|---|---|
| [`ide-reconnect`](plugins/ide-reconnect) | Notices when your editor is open but Claude lost the link, and runs `/ide` for you. |
| [`chat-callouts`](plugins/chat-callouts) | Marks who said what in the terminal, and puts drafts in their own copy-ready boxes. |

This repo is a plugin marketplace, so installing a mod is two lines.

> Both mods are early-access function-hook plugins. They need a Claude Code build that supports them, and `chat-callouts` only draws in the **terminal** UI (not the desktop app).

## Install

At the prompt of a terminal session:

```
/plugin marketplace add rnzsanchez/renz-claude-mods
/plugin install <mod>@renz-claude-mods
```

Or from a shell:

```
claude plugin marketplace add rnzsanchez/renz-claude-mods
claude plugin install <mod>@renz-claude-mods
```

Replace `<mod>` with `ide-reconnect` or `chat-callouts`. Mods with menu options show a screen for them during install, and you can change them later in `/plugin`.

## ide-reconnect

Editor open, Claude says it is not connected, you type `/ide`, again, next time. This does it for you.

Every 30 seconds it looks for a running editor whose workspace holds your session's folder (`~/.claude/ide/*.lock`). If one is open but your session has no TCP connection to its port (checked with `lsof`), it runs `/ide`, at most once every 5 minutes. Failures show up as a toast.

| Command | Arguments | What it does |
|---|---|---|
| `/ide-reconnect` | none | Runs the same check right now and tells you what it found. |

**Cost:** two short processes per 30 seconds (a liveness check and an `lsof`), only while an editor lock file matches. Zero prompt tokens.

## chat-callouts

Long sessions turn into one grey wall of text. This puts a name and a time on each message and a colored bar down the side, so you can tell your prompts from Claude's at a glance. It also asks Claude to wrap drafts (Slack, email, PR comment, ticket) in a fence and draws each one in its own box with a Copy button.

```
  ▌ You · 14:02                    <- cyan bar
  ▌ draft me a slack note about the outage
  
  ▌ Claude · 14:02                 <- orange bar
  ▌ Sure, here you go:
  
  ▌ ╔══════════════════════════════════════╗
  ▌ ║ Draft · Slack              [ Copy ]  ║
  ▌ ║ Heads up: the API was down 13:40 to  ║
  ▌ ║ 13:55. Fixed, root cause in the PR.  ║
  ▌ ╚══════════════════════════════════════╝
  ▌ Want it shorter?
```

| Command | Arguments | What it does |
|---|---|---|
| `/banners` | none | Shows the current settings and this list. |
| `/banners style` | `label`, `box` or `bar` | Picks the frame: name and time only, a rounded box, or a side bar. |
| `/banners width` | `1` to `8` | Bar thickness in eighths of a cell. |
| `/banners on` / `off` | none | Turns the labels and frames on or off. |
| `/banners stats` | none | Shows how long drawing a message takes. |
| `/draftcopy` | none | Copies the last draft Claude wrote. |

### Menu options

Set them in the install screen or in `/plugin` once the mod is selected.

| Option | Values | Default | What it does |
|---|---|---|---|
| Reply style | `label`, `box`, `bar` | `bar` | How Claude's replies are marked. |
| Bar width | `1` to `8` | `8` | Thickness of the bar. |
| Frame on my messages | on / off | on | Off leaves your own messages with just the `You` label. |
| Draft boxes | on / off | on | Off removes the drafting instruction and draws drafts as plain text. |

**Menu vs `/banners`:** a value you set with `/banners` is saved and wins across new sessions, hot reloads and `/reload-plugins`. The menu only seeds the defaults: with nothing saved, its values apply. When you later change a menu option, that option (that one only) replaces your saved `/banners` value the next time the mod loads.

**Cost:** about 70 prompt tokens per request, and only when Draft boxes is on. No timers, no processes.

### Terminal.app

macOS Terminal.app can show tiny gaps between rows of a bar thinner than 8. Width `8` (the default) is drawn as a solid background and is gap-free everywhere; if you pick a thinner bar and see gaps, that is the terminal, not the mod.

## Develop

Run a session with a mod loaded from its folder (saving a file reloads it):

```
claude --plugin-dir plugins/<mod>
```

Check and test a mod before committing:

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

The manifests carry no `version` field: every push to main is a release, because Claude Code then versions a mod by its commit.

Each mod's `.claude-plugin/types/` is written by the engine and git-ignored.

## License

[MIT](LICENSE) © 2026 Renz Sanchez
