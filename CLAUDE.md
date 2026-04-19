# CLAUDE.md — GHC Lucy Harness

## Technical Documentation & Reference

This project is built on the Microsoft stack (Azure, M365, .NET, TypeScript, Node.js).

**Always use these MCP tools for technical documentation and reference implementations:**

- **Microsoft Learn** (`microsoft-learn-*`) — Use `microsoft_docs_search` and `microsoft_code_sample_search` for any Azure, .NET, M365, TypeScript, or Microsoft SDK documentation. Follow up with `microsoft_docs_fetch` when search results reference a high-value page. This is the authoritative source for Microsoft APIs, SDKs, and services.
- **GitHub MCP** — Use for repository search, code examples, issue context, and reference implementations on GitHub. Prefer this for SDK source code, community patterns, and real-world usage examples.

**Rules:**
1. When answering any technical question about Microsoft/Azure services, SDKs, or APIs — **search MS Learn first**, then supplement with GitHub if needed.
2. When generating code that uses Microsoft SDKs — **search MS Learn code samples** for the latest official patterns before writing code.
3. When investigating bugs or compatibility issues — check both MS Learn docs and GitHub issues/source.
4. Never rely on training data alone for Microsoft API signatures, config schemas, or SDK usage — always verify against MS Learn.

## gstack

gstack is installed at `~/.claude/skills/gstack` and provides the following skills.

### Web Browsing

**Always use the `/browse` skill from gstack for ALL web browsing.**
**NEVER use `mcp__claude-in-chrome__*` tools.** The gstack browser is headless, faster, and works without Chrome extensions.

### Available Skills

| Skill | Purpose |
|-------|---------|
| `/office-hours` | Structured office hours sessions |
| `/plan-ceo-review` | Prepare CEO review materials |
| `/plan-eng-review` | Prepare engineering review materials |
| `/plan-design-review` | Prepare design review materials |
| `/plan-devex-review` | Prepare developer experience review |
| `/design-consultation` | Interactive design consultation |
| `/design-shotgun` | Rapid-fire design exploration |
| `/design-html` | Generate HTML design artifacts |
| `/design-review` | Conduct design reviews |
| `/review` | Code review |
| `/ship` | Ship code (merge, deploy pipeline) |
| `/land-and-deploy` | Land PRs and deploy |
| `/canary` | Canary deployment management |
| `/benchmark` | Performance benchmarking |
| `/browse` | **Headless web browsing** (preferred over all other browser tools) |
| `/connect-chrome` | Connect to running Chrome instance |
| `/qa` | Quality assurance testing |
| `/qa-only` | QA-only pass (no code changes) |
| `/setup-browser-cookies` | Configure browser cookies for auth |
| `/setup-deploy` | Set up deployment pipeline |
| `/retro` | Run a retrospective |
| `/investigate` | Deep investigation of issues |
| `/document-release` | Document a release |
| `/codex` | Codex integration |
| `/cso` | Chief of Staff operations |
| `/autoplan` | Automatic planning |
| `/devex-review` | Developer experience review |
| `/careful` | Extra-careful mode (slower, more thorough) |
| `/freeze` | Freeze deployments |
| `/guard` | Guard mode (safety checks) |
| `/unfreeze` | Unfreeze deployments |
| `/gstack-upgrade` | Upgrade gstack itself |
| `/learn` | Learn from documentation and context |
