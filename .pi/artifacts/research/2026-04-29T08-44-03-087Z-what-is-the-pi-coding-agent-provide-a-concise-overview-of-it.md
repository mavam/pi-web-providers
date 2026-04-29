# Web research report

## Query
What is the pi coding agent? Provide a concise overview of its purpose, capabilities, and where to find documentation.

## Provider
Brave

## Status
completed

## Started
2026-04-29T08:44:03.087Z

## Completed
2026-04-29T08:44:08.351Z

## Elapsed
5s

## Items
0

## Report
Pi is a minimalist, open-source AI coding agent designed to run in the terminal and automate software development tasks. Created by Mario Zechner, the developer behind the libGDX framework, Pi emphasizes simplicity, extensibility, and developer control.

**Purpose:**  
Pi serves as a lightweight coding harness that orchestrates large language models (LLMs) for practical programming work. Its core philosophy is to provide minimal built-in functionality—only four essential tools:  
- **read**: Access file contents  
- **write**: Create or overwrite files  
- **edit**: Make precise changes to code  
- **bash**: Execute shell commands  

Instead of bundling features, Pi encourages users to extend its capabilities through custom code, aligning with the idea that "if you want the agent to do something, ask the agent to build it."

**Capabilities:**  
- Supports over 15 LLM providers (e.g., OpenAI, Anthropic, Google, Groq, xAI) with mid-session model switching.  
- Offers tree-structured sessions for preserving workflow branches and enabling non-linear exploration.  
- Features a TypeScript-based extension system with hot-reloading, allowing deep customization of tools, prompts, themes, and behaviors.  
- Includes session persistence, cost and token tracking, and embeddable SDK for integration into larger systems.  
- Powers **OpenClaw**, a popular personal AI assistant with over 160,000 GitHub stars, demonstrating its scalability and reliability.  

Pi is ideal for developers and teams seeking a transparent, auditable, and customizable AI automation solution without vendor lock-in.

**Documentation & Resources:**  
- Official website: [https://shittycodingagent.ai](https://shittycodingagent.ai)  
- GitHub repository: [https://github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)  
- Installation: $$npm install -g @mariozechner/pi-coding-agent$$  
- Community guides and technical deep dives are available on platforms like Medium, Substack, and personal blogs of notable developers such as Armin Ronacher.
