# Web research report

## Query
What is pi coding agent? Provide a concise overview of its purpose, main features, modes, extensibility model, supported providers/models, and how to get started. Prefer official sources such as pi.dev, GitHub, npm, and documentation.

## Provider
Brave

## Status
completed

## Started
2026-04-29T08:41:08.005Z

## Completed
2026-04-29T08:41:22.939Z

## Elapsed
14s

## Items
0

## Report
Pi Coding Agent is a minimal, open-source, terminal-based AI coding agent created by Mario Zechner, the developer behind the libGDX framework. It is designed to automate software development tasks through a lightweight, extensible architecture that prioritizes developer control and transparency. The official project resources are hosted at [pi.dev](https://shittycodingagent.ai), its GitHub repository [badlogic/pi-mono](https://github.com/badlogic/pi-mono), and the npm package [@mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).

### Purpose
Pi serves as a minimalist coding harness that orchestrates large language models (LLMs) for practical programming tasks. Rather than bundling numerous built-in features, Pi emphasizes simplicity and adaptability, allowing developers to shape the agent to their workflows. It powers real-world systems like OpenClaw and is ideal for users who prefer a transparent, auditable, and customizable AI assistant over a feature-heavy, opinionated tool.

### Main Features
- **Four Core Tools**: `read` (read files), `write` (create files), `edit` (make surgical code changes), and `bash` (execute terminal commands).
- **Minimal System Prompt**: One of the shortest in the industry (~200–300 words), preserving context window space for actual code and project data.
- **Tree-Structured Sessions**: Every interaction is stored in a branching JSONL format, enabling non-linear exploration, rewinding, and preservation of alternative development paths.
- **Mid-Session Model Switching**: Supports seamless switching between different LLMs during a session to leverage the strengths of each model.
- **Cost and Token Tracking**: Built-in tracking for API usage and expenses across providers.

### Modes of Operation
Pi supports four execution modes:
- **Interactive**: Terminal-based conversational interface with a responsive TUI (Terminal UI).
- **Print/JSON**: Non-interactive mode for scripting and automation, outputting results in plain text or structured JSON.
- **RPC**: Enables integration with external processes via remote procedure calls.
- **SDK Mode**: Allows embedding Pi into custom applications using its TypeScript API, as demonstrated in OpenClaw.

### Extensibility Model
Pi is designed to be extended rather than configured. It provides over 25 hooks and a modular plugin system:
- **TypeScript Extensions**: Full plugins that can add tools, commands, UI components, safety checks, and more. These are hot-reloadable and run with full system access.
- **Skills**: Markdown-based workflows for complex, reusable tasks (e.g., debugging, refactoring).
- **Prompt Templates**: Custom slash commands (e.g., `/review`, `/test`) using predefined prompts.
- **Packages**: Shareable bundles (via npm or git) containing extensions, skills, themes, and settings.
- **Self-Modification**: Users can ask Pi to build its own extensions, embodying the principle of "code writing code."

### Supported Providers and Models
Pi supports **15+ LLM providers**, including:
- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude Opus, Sonnet, Haiku)
- Google (Gemini)
- xAI (Grok)
- Groq
- Ollama (for local models)
- OpenRouter and any OpenAI-compatible endpoint

Authentication is supported via API keys or OAuth using existing subscriptions (e.g., Claude Pro, ChatGPT Plus). Model selection is flexible, with fuzzy matching and role-based model assignment (e.g., `--plan`, `--smol`).

### How to Get Started
1. **Install** via npm:
   ```bash
   npm install -g @mariozechner/pi-coding-agent
   ```
2. **Authenticate**:
   - Use an API key:
     ```bash
     export OPENAI_API_KEY=your_key
     ```
   - Or use OAuth with an existing subscription:
     ```bash
     pi /login
     ```
3. **Launch** in a project directory:
   ```bash
   pi
   ```
4. **Interact** using natural language prompts. For example:
   - "Read main.py"
   - "Fix the bug in the login function"
   - "Run the tests"

5. **Extend** by installing packages:
   ```bash
   pi install @user/pi-package -l  # Install locally
   ```

Project-specific configurations (e.g., default models, extensions, skills) can be placed in a `.pi/` directory for team-wide consistency.

Pi is MIT-licensed, fully open-source, and designed for developers who want full control over their AI coding assistant—making it a powerful foundation for building custom ag
