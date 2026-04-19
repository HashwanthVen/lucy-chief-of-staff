# Copilot Setup Instructions for Lucy

## For biz users — just paste this to your Copilot CLI:

```
Clone https://github.com/v-sutharapuh_microsoft/lucy-ghcopilotsdk-chief-of-staff, install deps, and start the server. If Node.js or GitHub CLI isn't installed, install them first.
```

That's it. Copilot will handle the rest.

## What Copilot will do:
1. Check prerequisites (Node.js 18+, gh CLI)
2. Install missing tools if needed
3. Clone the repo
4. Run `npm install`
5. Run `npm start`
6. Tell you to open http://localhost:4242

## Personalizing for yourself:
Paste this to Copilot after setup:
```
Update src/user-context.ts with my info: [your name], [your email], my team is [names], my domain is [your domain], my projects are [project names]. Also update soul/SOUL.md Identity section with my name. Then restart the server.
```
