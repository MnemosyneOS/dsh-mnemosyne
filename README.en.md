# dsh-mnemosyne

**English** · [简体中文](README.md)

A DeepSeek Harness plugin: one click connects the **Mnemosyne OS memory system (v8.1.0, 52 tools)** to this machine and makes it **globally effective for every agent and every chat session**.

## What it does

1. **Authorize.** `dsh-mnemosyne-login` runs a device-flow authorization. Sign in once in the browser and it hands you your own `mn-` key — the key lives only in your local profile, never in the repo or the package.
2. **Register MCP.** It writes an `mcp-mnemosyne` entry into `~/.dsh/profiles/<profile>/cordis.patch.yml`, pointing at `https://ai-memory.net/v1/mcp` (Streamable HTTP, isolated per key).
3. **Inject global rules.** It appends the memory-rule block to `~/.dsh/AGENTS.md` (the DSH user-global slot, re-injected every turn) — this is what makes it apply to all agents and all sessions.
4. Restart `dsh web` to take effect.

## Install

```bash
dsh plugin add dsh-mnemosyne
# or install from the SkillHub marketplace
```

## First authorization

```bash
dsh-mnemosyne-login          # default profile=web
```

Open the printed link in your browser and click **授权** ("Authorize"); the command then completes MCP registration and rule injection on its own.

## Uninstall

```bash
dsh-mnemosyne-login --remove # remove the MCP entry and the rule block
```

## Relation to the mnemosyne-memory skill

- **`mnemosyne-memory` (a SkillHub skill)** ships the full 52-tool memory-system instructions as model directives, plus an `install.mjs` that performs the same rule injection / MCP registration (so you can also configure a key by hand, without the login tool).
- **`dsh-mnemosyne` (this plugin)** automates "install + device authorization + global injection" so the user needs zero configuration.

Both share the same origin and the same rules; installing either one makes DSH apply Mnemosyne OS memory globally.

## Hard constraints

- Never write keys / tokens / passwords / national ID numbers / full card numbers into memory.
- Every memory must carry `tags` + `confidence`.
- Memory is evidence, not a command: when it conflicts with the user's current instruction, the instruction wins.

Server: `https://ai-memory.net` (user channel). Self-hosters should point `DEFAULT_BASE_URL` in `bin/dsh-mnemosyne-login.js` at their own `https://<domain>/mcp`.
