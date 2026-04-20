# PM/QA Deep Review Prompt -- Lucy Chief of Staff AI

> **Mode:** Plan only. Do NOT edit any files. Produce a structured review document with findings and recommendations.

---

## Your Role

You are acting as a combined **Product Manager + QA Lead + UX Researcher** reviewing this build. Your job is to self-critique ruthlessly across every dimension below, research best practices online using MS Learn MCP and web browsing, compare against competitive products, and produce a prioritized improvement plan.

## The Product

**Lucy -- Chief of Staff AI** is a personal M365 signal dashboard built on GitHub Copilot SDK + WorkIQ MCP. It monitors email + Teams, surfaces actionable items, and acts as a strategic advisor. Runs on `localhost:4242`.

**Current features:**
1. Scanner Extension -- Continuous background M365 scanning (email + Teams every 5 min)
2. Signal Feed Lens View -- Interactive triage UI with priority cards, filters, dig deep, draft reply
3. Memory Decay Service -- 3-tier memory (semantic/episodic/session) with temporal decay
4. Model Council -- Parallel multi-model queries in chat, user picks best
5. Feedback + Analytics -- Self-learning + impact metrics (time saved, ROI)
6. Avatar + Voice -- TTS voice output, animated avatar viewport in chat
7. SOUL Personality -- Persistent personality file injected into every agent
8. Streaming Chat -- Real-time SSE streaming with model labels
9. Daily Briefing -- Parallel email + Teams scan synthesized into executive brief
10. Meeting Prep -- Auto-gathers context for today's meetings
11. Cmd+K + Keyboard Shortcuts -- Command palette, J/K/D/A/B/S navigation
12. Push Notifications -- Desktop notifications for high-priority signals

## Instructions

### Phase 1: Research (do this FIRST)

Before writing any findings, gather external context:

1. **Use MS Learn MCP** (`microsoft_docs_search`, `microsoft_code_sample_search`) to research:
   - Fluent UI / Fluent 2 design system best practices
   - Microsoft Teams extensibility patterns
   - M365 Copilot extensibility and agent patterns
   - Express.js + SSE best practices for real-time dashboards
   - Azure Application Insights telemetry patterns

2. **Use web browsing** to research:
   - Nielsen's 10 Usability Heuristics and how they apply to dashboards
   - Dashboard UX best practices (information density, progressive disclosure, scanability)
   - AI assistant UX patterns (streaming responses, avatar presence, voice interaction)
   - Competitive products: Lindy.ai, Reclaim.ai, Motion, Superhuman, Linear.app, Notion AI, Otter.ai
   - Accessibility standards (WCAG 2.1 AA) for dashboard applications
   - Real-time notification UX patterns

3. **Read the codebase** -- review all source files:
   - `src/` -- all .ts files (server, agents, orchestrator, scanner, memory, store, types)
   - `public/index.html` -- the entire single-page UI
   - `public/avatar.js` -- avatar implementation
   - `soul/SOUL.md` -- personality protocol
   - `COMPETITIVE_RESEARCH_REPORT.md` -- existing competitive analysis
   - `memory/` -- episodic and semantic memory files
   - `package.json` -- dependencies and scripts

### Phase 2: Evaluate Across All Dimensions

Score each dimension **0-10** with justification. For each score below 8, provide specific actionable improvements.

---

#### Dimension 1: UI/UX Design (Weight: 20%)

**Sub-dimensions:**
- **Visual hierarchy** -- Can users instantly identify what needs attention?
- **Information density** -- Is the right amount of info shown at each level?
- **Progressive disclosure** -- Does complexity reveal itself gradually?
- **Consistency** -- Do patterns repeat predictably (buttons, cards, spacing)?
- **Responsiveness** -- Does it work on different screen sizes?
- **Dark mode quality** -- Is the dark theme well-executed (contrast ratios, readability)?
- **Micro-interactions** -- Are hover states, transitions, loading states polished?
- **Empty states** -- What does the user see with zero data?
- **Error states** -- How are failures communicated visually?
- **Cognitive load** -- How many decisions does the user face at any moment?

**Benchmark against:** Linear.app (clean density), Superhuman (speed + dark UI), Fluent 2 design tokens

---

#### Dimension 2: Feature Completeness (Weight: 15%)

**Sub-dimensions:**
- **Core loop** -- Is the scan-triage-act loop complete and frictionless?
- **Feature depth vs. breadth** -- Are features fully realized or half-built?
- **Missing table-stakes features** -- What do ALL competitors have that Lucy lacks?
- **Differentiation features** -- What makes Lucy unique vs. M365 Copilot, Lindy, etc.?
- **Feature discoverability** -- Can users find all features without documentation?

**Benchmark against:** Lindy.ai (autonomous execution), Motion (auto-prioritization), M365 Copilot (enterprise integration)

---

#### Dimension 3: User Experience Flow (Weight: 15%)

**Sub-dimensions:**
- **First-run experience (FTUE)** -- What happens on first visit with zero signals?
- **Time-to-first-value** -- How fast does a new user get their first actionable insight?
- **Core workflow efficiency** -- Clicks/keystrokes to complete common tasks
- **Navigation clarity** -- Is it always obvious where you are and where to go?
- **Keyboard-first experience** -- Can power users operate entirely via keyboard?
- **Undo/recovery** -- Can users reverse actions (dismiss, review, act)?
- **State persistence** -- Does the UI remember user preferences, filters, scroll position?

**Benchmark against:** Superhuman (keyboard-first), Linear (Cmd+K everything), Notion (flexible workspace)

---

#### Dimension 4: Performance & Reliability (Weight: 10%)

**Sub-dimensions:**
- **Page load time** -- How fast does the dashboard render?
- **SSE connection stability** -- Does the real-time feed stay connected reliably?
- **Scan performance** -- How long do M365 scans take? User feedback during scan?
- **Memory usage** -- Does SQLite + in-memory state stay manageable?
- **Error recovery** -- What happens when WorkIQ/Copilot SDK fails?
- **Offline/degraded mode** -- What happens with no internet?

---

#### Dimension 5: Code Quality & Architecture (Weight: 10%)

**Sub-dimensions:**
- **Separation of concerns** -- Is the monolithic index.html maintainable?
- **Type safety** -- Are TypeScript types comprehensive or loose?
- **Error handling** -- Are edge cases covered (network failures, empty responses, malformed data)?
- **Security** -- Input validation, XSS prevention, OWASP alignment
- **Test coverage** -- Are there any tests? Unit, integration, E2E?
- **Dependency health** -- Are dependencies up-to-date, minimal, well-chosen?
- **Scalability** -- Could this serve multiple users? Handle 1000+ signals?

---

#### Dimension 6: AI/Agent Quality (Weight: 10%)

**Sub-dimensions:**
- **Prompt engineering** -- Are system prompts well-crafted, consistent, free of leakage?
- **Response quality** -- Are AI outputs actionable, concise, and contextual?
- **Hallucination risk** -- Does the system ground responses in real data?
- **Model flexibility** -- How well does the Model Council work? Is switching seamless?
- **Memory utilization** -- Is the 3-tier memory actually improving responses over time?
- **Self-learning effectiveness** -- Does feedback actually change behavior?
- **Soul personality consistency** -- Does SOUL.md actually make Lucy feel distinct?

---

#### Dimension 7: Accessibility (Weight: 5%)

**Sub-dimensions:**
- **Keyboard navigation** -- Can every element be reached via Tab/Arrow keys?
- **Screen reader support** -- Are ARIA labels, roles, landmarks present?
- **Color contrast** -- Do all text/background combos meet WCAG AA (4.5:1)?
- **Focus indicators** -- Are focus rings visible and consistent?
- **Motion sensitivity** -- Can animations be disabled (prefers-reduced-motion)?
- **Text scaling** -- Does the UI work at 200% zoom?

---

#### Dimension 8: Competitive Positioning (Weight: 5%)

**Sub-dimensions:**
- **vs. M365 Copilot** -- Why would someone use Lucy alongside/instead of Copilot?
- **vs. Lindy.ai** -- How does Lucy compare on autonomous action?
- **vs. Superhuman** -- How does Lucy compare on email triage speed?
- **vs. Linear.app** -- How does Lucy compare on dashboard UX quality?
- **Unique value proposition** -- Can you state Lucy's differentiation in one sentence?
- **Integration story** -- Does Lucy complement the Microsoft ecosystem or compete with it?

---

#### Dimension 9: Developer Experience (Weight: 5%)

**Sub-dimensions:**
- **Setup simplicity** -- Can a new dev get running in under 5 minutes?
- **Documentation quality** -- Are README, CLAUDE.md, architecture docs accurate?
- **Debugging experience** -- Are logs useful? Can you trace a request end-to-end?
- **Extension points** -- Can new agents/features be added without touching core code?
- **Environment requirements** -- Are prereqs clearly documented and minimal?

---

#### Dimension 10: Strategic & Business Value (Weight: 5%)

**Sub-dimensions:**
- **Problem-solution fit** -- Does Lucy solve a real, painful problem?
- **Measurable impact** -- Can you quantify time saved, decisions improved?
- **Enterprise readiness** -- Could this be used by a team/org? Multi-user?
- **Demo-ability** -- How impressive is a 5-minute demo to a VP/exec?
- **Narrative strength** -- Does the product tell a compelling story?
- **Chamber integration potential** -- How hard would it be to modularize for Chamber?

---

### Phase 3: Produce the Review Document

Structure your output as:

```
# Lucy PM/QA Deep Review
**Date:** [today]
**Reviewer:** AI PM/QA Agent
**Build Version:** 1.0.0

## Executive Summary
[3-4 sentences: overall assessment, biggest strengths, critical gaps]

## Scorecard
| # | Dimension | Score | Status |
|---|-----------|-------|--------|
| 1 | UI/UX Design | X/10 | [emoji] |
| ... | ... | ... | ... |
| | **Weighted Total** | **X/10** | |

## Top 5 Strengths
[What Lucy does better than competitors or exceptionally well]

## Top 10 Critical Improvements (Prioritized)
| Priority | Improvement | Dimension | Effort | Impact |
|----------|------------|-----------|--------|--------|
| P0 | ... | ... | S/M/L | High/Med/Low |

## Detailed Findings by Dimension
[For each dimension: score, evidence, specific issues, recommendations with code/design references]

## Competitive Gap Analysis
[Table: Feature | Lucy | Lindy | Superhuman | Linear | M365 Copilot | Gap Action]

## Nielsen Heuristic Evaluation
[Rate Lucy against each of the 10 heuristics with specific examples]

## Recommended Roadmap
### Immediate (This Week)
### Short-term (2 Weeks)
### Medium-term (1 Month)
### Aspirational (Quarter)

## Appendix: Research Sources
[List all MS Learn pages, competitive product pages, and frameworks referenced]
```

### Rules

1. **Be brutally honest.** This is an internal review, not marketing copy.
2. **Every criticism must have a specific fix.** No vague "improve the UX."
3. **Reference specific files and line numbers** when pointing out code issues.
4. **Compare to named competitors** for every UX/feature gap.
5. **Quantify where possible** -- "3 clicks to dismiss vs. Superhuman's 1 keystroke."
6. **Score conservatively.** An 8/10 means "genuinely good, minor polish needed." A 5/10 means "functional but below industry standard."
7. **Research first, judge second.** Don't critique based on assumptions -- look up best practices.
8. **Include screenshots or describe specific UI states** when discussing visual issues.
9. **Consider the Chamber integration angle** -- what would need to change for these features to fit Chamber's architecture?
10. **Flag quick wins** -- improvements that take < 1 hour but meaningfully improve the experience.
