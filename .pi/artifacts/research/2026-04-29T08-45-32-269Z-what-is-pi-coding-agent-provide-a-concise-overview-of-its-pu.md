# Web research report

## Query
What is pi coding agent? Provide a concise overview of its purpose, main features, modes of operation, customization options, and where to find documentation.

## Provider
Brave

## Status
completed

## Started
2026-04-29T08:45:32.269Z

## Completed
2026-04-29T08:45:39.813Z

## Elapsed
7s

## Items
0

## Report
Pi is a minimal, open-source terminal-based AI coding agent created by Mario Zechner, the developer behind the libGDX framework. It is designed to automate software development tasks through a deliberately stripped-down core, emphasizing extensibility and developer control over built-in features.

**Purpose**  
Pi serves as a lightweight coding harness that enables developers to interact with large language models (LLMs) for practical programming tasks. Its core philosophy is to provide minimal defaults—only four essential tools and a short system prompt—and allow users to extend functionality as needed, either manually or by instructing the agent to modify itself. It powers OpenClaw, a chat-connected agent platform, via its SDK.

**Main Features**  
- **Four Core Tools**: `read`, `write`, `edit`, and `bash`—covering file access, creation, modification, and shell command execution.
- **Minimal System Prompt**: One of the shortest among coding agents, promoting clarity and reducing prompt bloat.
- **Multi-Provider LLM Support**: Works with 15+ providers including Anthropic, OpenAI, Google Gemini, Mistral, Groq, and Azure, with mid-session model switching via `/model` or `Ctrl+P`.
- **Tree-Structured Sessions**: Sessions are stored as JSONL files with parent-child relationships, enabling branching, forking, rewinding, and non-linear exploration without losing history.
- **Cost and Token Tracking**: Built-in monitoring for API usage across providers.

**Modes of Operation**  
Pi operates in multiple modes:
- **Interactive TUI**: Standard terminal interface for conversational coding.
- **One-shot Query**: Run a single command with `pi -p "query"`.
- **JSON Mode**: Output structured JSON responses with `--mode json`.
- **RPC Mode**: Use strict JSONL framing for integration with external clients.
- **SDK Mode**: Embed Pi into applications using `createAgentSession` for building custom agent-backed tools.

**Customization Options**  
Pi supports deep customization through:
- **Extensions**: Write TypeScript modules to add tools, commands, UI widgets, or modify behavior. Extensions can register providers, handle events, and persist state.
- **Skills**: Reusable, portable capabilities defined in `SKILL.md` files that load on-demand to avoid context pollution.
- **Packages**: Distribute extensions via npm or git and manage them using `pi install`, `pi remove`, and `pi update`.
- **Configuration Files**: Use `AGENTS.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md` for project- or global-level instructions.
- **Themes and Hooks**: Customize appearance and behavior using over 25 available hooks for tools, prompts, key bindings, and UI elements.

**Documentation**  
Official documentation, installation guides, and source code are available at:
- GitHub repository: [https://github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- Project website: [https://shittycodingagent.ai](https://shittycodingagent.ai)
