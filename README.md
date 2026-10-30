# renz-claude-mods

Claude Code mods, one folder per mod under `plugins/`. The repository is a plugin marketplace (`.claude-plugin/marketplace.json`).

## Mods

| Mod | What it does |
|---|---|
| `ide-reconnect` | Every 30 seconds, checks for a running editor whose workspace holds the session's folder (`~/.claude/ide/*.lock`). If one is open but the `ide` MCP server does not answer, it runs `/ide`, at most once every 5 minutes. `/ide-reconnect` runs the same check on demand. |

## Install

At the prompt of a terminal session:

```
/plugin install <mod> --marketplace <owner>/renz-claude-mods
```

From a shell:

```
claude plugin install <mod> --marketplace <owner>/renz-claude-mods
```

## Develop

Run a session with a mod loaded from its folder:

```
claude --plugin-dir plugins/<mod>
```

Check a mod before committing:

```
claude plugin validate plugins/<mod>
```
