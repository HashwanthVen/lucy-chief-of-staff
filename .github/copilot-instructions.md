# Copilot Setup Instructions for Lucy

## For new users — paste this single prompt into Copilot CLI:

```
Clone https://github.com/v-sutharapuh_microsoft/lucy-ghcopilotsdk-chief-of-staff, run npm install, then npm start. If Node.js isn't installed, install it first. Accept any WorkIQ EULA prompts.
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
