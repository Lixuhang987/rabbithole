# Codex ego-browser

Subscription Codex exposes only the installed ego-browser skill when both its
CLI and skill file are available. The bridge reads `~/.agents/skills/ego-browser/SKILL.md`
(falling back to `~/.codex/skills/ego-browser/SKILL.md`) and resolves symlinks,
so Ego application upgrades do not pin an old version. If Ego is not installed,
ordinary article generation continues without the browser capability.

For services with a different PATH or skill location, set
`RABBITHOLE_BRIDGE_EGO_BIN` to the Ego executable and
`RABBITHOLE_BRIDGE_EGO_SKILL` to its `SKILL.md`. An explicitly configured missing
installation or a skill with a different name fails clearly. Restart the bridge
after changing its environment or updating the skill. Keep the pairing token.

The bridge injects the selected skill's complete instructions into current
Codex developer instructions; it does not enable Codex's general skill catalog.
A bridge-owned MCP server provides one `ego_browser` tool for Node scripts,
skill references, and screenshots. All user MCP servers remain disabled.
New threads and forks of existing article conversations use this capability.
No user Codex configuration or authentication files are rewritten.

For external information, answering instructions prioritize native web search.
Ego is the fallback when search is unavailable, fails, or cannot retrieve the
required content; this priority overrides the skill's browser-first preference.

The tool launches `ego-browser nodejs` directly, without exposing a shell tool.
Codex runs with full filesystem/network access and no approval prompts at
process, thread, and turn boundaries, while skill/tool exposure remains restricted.
Ego's embedded Node scripts also run locally with browser/account and filesystem
access; the absence of a shell tool does not restrict this MCP subprocess.
Calls have bounded output and
duration; supporting-file and screenshot reads stay inside their owning
directories. TaskSpace ownership, browser interactions, and completion follow
the selected skill's instructions.

The deterministic HTTP/MCP integration tests cover exposure and tool outputs.
Installed-Codex acceptance uses a loopback provider and fixture Ego executable
to verify the model-visible skill and browser call after a legacy-source fork.
Real browser/account access requires local Ego acceptance.
