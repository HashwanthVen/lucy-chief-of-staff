# Copilot Setup Instructions for Lucy

## For new users — paste this single prompt into Copilot CLI:

```
I want to set up Lucy — a Chief of Staff AI dashboard. Here's what I need you to do end-to-end without asking me any questions:

1. Check if Node.js 18+ is installed. If not, install it (use winget on Windows, brew on Mac).
2. Check if GitHub CLI (gh) is installed. If not, install it (winget install GitHub.cli on Windows, brew install gh on Mac).
3. Check if I'm logged into GitHub CLI. If not, run gh auth login and walk me through it.
4. Clone this repo: https://github.com/v-sutharapuh_microsoft/lucy-ghcopilotsdk-chief-of-staff
5. cd into the cloned folder and run npm install.
6. Personalize Lucy for me:
   a. Look up my GitHub profile to get my display name and email (use gh api user).
   b. Update src/user-context.ts with my real name, email, and set team/domain/projects to empty arrays for now.
7. Run npm start to launch the server.
8. Wait for the server to print "Lucy ready" in the console (this takes ~60 seconds as 4 AI agents initialize).
9. Once ready, open http://localhost:4242 in my browser.
10. If there are any EULA or permission prompts, accept them automatically.
11. Tell me when everything is running, what I'm looking at, and how to use it. Mention they can customize Lucy's personality anytime via the Soul tab in the dashboard, and teach her preferences via the "Teach Lucy" input.

Important: Do NOT ask me to do anything manually. Handle every step yourself. If something fails, troubleshoot and fix it before moving on.
```

## What Copilot will do:
1. Check/install Node.js 18+
2. Clone the repo
3. Run `npm install`
4. Run `npm start` → Lucy auto-handles WorkIQ EULA acceptance
5. Open http://localhost:4242

## Personalizing — paste this after setup:
```
Update src/user-context.ts with my info: [your name], [your email], my team is [names], my domain is [your domain], my projects are [project names]. Also update soul/SOUL.md Identity section. Then restart with npm start.
```

## Initial onboarding (auto-fills SOUL from M365):
On first run, Lucy's scanner will query WorkIQ to learn about the user — their recent contacts, active projects, communication patterns — and seed the semantic memory automatically. The SOUL.md ships with a template that works out of the box; users can customize it anytime via the Soul tab in the dashboard.
