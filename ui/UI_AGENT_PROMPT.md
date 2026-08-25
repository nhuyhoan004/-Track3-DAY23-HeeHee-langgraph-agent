# UI AGENT PROMPT
# LangGraph Support-Ticket Agent — Frontend Chatbot Interface

---

## SKILL TO USE FIRST

Before writing any design or code, you MUST read and follow the design skill at:
`D:\codein\misp@ce\aiaction\skills\skills\frontend-design\SKILL.md`

This skill governs how to approach all design decisions. Follow its two-pass process:
1. Brainstorm design plan (palette, typography, layout, signature)
2. Critique it against AI-default patterns, then build

---

## PROJECT CONTEXT

You are building a **standalone frontend** for a LangGraph-powered support-ticket agent.

This is a **lab demo** showcasing:
- Real-time LLM-based ticket classification into 5 routes: `simple`, `tool`, `missing_info`, `risky`, `error`
- Conditional graph routing with nodes: intake → classify → (route) → ... → finalize
- Retry loops with attempt counter
- Human-In-The-Loop (HITL) approval for risky actions
- SQLite-persisted checkpoints per thread
- Metrics: latency, nodes visited, retry count, interrupts

**The product's soul**: A transparent, auditable AI agent. The UI must make the "graph thinking" visible — not hide it. This is an observatory, not a black box.

---

## OUTPUT LOCATION

All files go to:
`d:\codein\misp@ce\aiaction\phase2-k3-4-track3-day8-2A202601380-NguyenTuanDuc\ui\`

- `ui/index.html`   — Main chatbot interface (self-contained, all CSS + JS inline or co-located)
- `ui/style.css`    — Design system / stylesheet
- `ui/app.js`       — Frontend logic (mock data, interactions, animations)
- `ui/README.md`    — Integration notes for later backend hookup

DO NOT touch anything outside the `ui/` folder.
This is purely frontend — no Python, no backend, no API calls needed yet.
Use realistic mock data to simulate all states.

---

## DESIGN BRIEF

### Subject & Audience
**Subject**: An AI support-ticket orchestration agent powered by LangGraph
**Audience**: Technical judges / lab reviewers evaluating the system
**Page's single job**: Demonstrate the agent's intelligence and transparency in real-time

### The Signature Element (must be present and memorable)
A **live graph trace panel** — as a user types a query and "submits" it, a vertical node-chain animates from top to bottom, lighting up each node (`intake` → `classify` → routing decision → ...) as the agent "thinks". This is the one element that makes this UI unmistakable. It is the beating heart of the lab's thesis: LangGraph makes reasoning visible.

---

## DESIGN SYSTEM — TOKEN SPECIFICATION

### Palette (6 named hex values — do not substitute generics)
```
--bg-void:       #0A0C10   /* near-black canvas, cooler than pure black */
--bg-surface:    #111318   /* card/panel surface */
--bg-elevated:   #1C1F28   /* hover states, input backgrounds */
--accent-graph:  #4FDFB2   /* teal-mint: the "signal" color for active nodes / graph trace */
--accent-risky:  #FF6B6B   /* coral-red: risky route, approval warnings */
--accent-tool:   #7C9EFF   /* periwinkle: tool-route, data lookup */
--accent-simple: #A8E6A3   /* sage green: simple route success */
--accent-error:  #FFB347   /* amber: error/retry state */
--text-primary:  #E8EAF0   /* near-white body text */
--text-muted:    #6B7280   /* secondary labels, node names */
--border-dim:    #1E2330   /* subtle panel borders */
```

**Why this palette**: The dark base signals "infrastructure/terminal" without resorting to hacker-green clichés. The teal-mint `--accent-graph` is derived from graph theory visualization conventions (nodes, edges, signals) — it earns its presence. Each route has its own accent — this encodes semantic meaning into color, not just decoration.

**DO NOT use**: plain white backgrounds, standard blue (#3B82F6), gray-on-white, cream/warm neutrals, or any color that matches the three AI-default patterns described in the skill (terracotta+cream, acid-green+black, newspaper columns).

### Typography
- **Display**: `Space Grotesk` (from Google Fonts) — weights 400, 600, 700
  - Use for: node names in the graph trace, route badge labels, metric numbers
  - Character: geometric, slightly technical, distinctive terminals on letters
- **Body**: `Inter` (from Google Fonts) — weights 400, 500
  - Use for: chat messages, explanatory copy, input fields
- **Mono**: `JetBrains Mono` (from Google Fonts) — weight 400
  - Use for: JSON/state dumps, event logs, attempt counters, latency ms values

**Type scale** (strict, no ad-hoc font-size):
```
--text-xs:  11px / 1.4 (metric labels)
--text-sm:  13px / 1.5 (muted captions)
--text-md:  15px / 1.6 (body, chat messages)
--text-lg:  18px / 1.4 (section headers)
--text-xl:  24px / 1.2 (node names in trace)
--text-2xl: 32px / 1.1 (metric big numbers)
```

---

## LAYOUT SPECIFICATION

### 3-panel layout (desktop-first, 1280px+)

```
┌─────────────────────────────────────────────────────────────────────┐
│  HEADER: "LangGraph Agent" | Thread ID badge | Status dot           │
├──────────────────┬──────────────────────┬───────────────────────────┤
│                  │                      │                           │
│  GRAPH TRACE     │   CHAT PANEL         │   METRICS PANEL           │
│  (left, 260px)   │   (center, flex)     │   (right, 280px)          │
│                  │                      │                           │
│  Vertical chain  │  Message bubbles     │  Live counters:           │
│  of nodes that   │  (user + agent)      │  - Route badge            │
│  animate as      │                      │  - Nodes visited          │
│  agent processes │  Input + send        │  - Retries                │
│                  │                      │  - Latency ms             │
│                  │                      │  - Approval status        │
│                  │                      │                           │
│                  │                      │  Event log (scrollable)   │
└──────────────────┴──────────────────────┴───────────────────────────┘
```

**On mobile (<768px)**: Stack vertically. Chat panel full width. Graph trace collapses to a horizontal mini-trace at top. Metrics panel collapses to a bottom sheet toggle.

---

## COMPONENT SPECIFICATIONS

### 1. Graph Trace Panel (LEFT)
- Shows the 11 nodes as a vertical chain with connecting lines
- Node states: `idle` (dim, text-muted), `active` (pulsing ring, accent-graph), `completed` (solid fill, checkmark), `skipped` (strikethrough, very dim)
- When a query is submitted, nodes animate sequentially from top to bottom with 200-400ms stagger
- The active node has a glowing ring animation (subtle box-shadow pulse on --accent-graph)
- Dead letter path: nodes after the branch point animate in coral (--accent-risky)
- Node list (in order): `intake` → `classify` → `[route decision]` → `tool` (if needed) → `evaluate` → `retry` → `dead_letter` / `answer` / `clarify` → `approval` → `finalize`
- Clicking a completed node shows its event payload in a tooltip/popover

### 2. Chat Panel (CENTER)
- Dark bubble messages, user right-aligned, agent left-aligned
- User bubbles: bg `--bg-elevated`, border 1px `--border-dim`
- Agent bubbles: bg `#141820`, left border 3px colored by route (`--accent-graph` default)
- When route=`risky`: agent bubble has left border `--accent-risky`, shows an APPROVAL GATE card with "Approve" / "Reject" buttons
- When route=`missing_info`: agent bubble shows a question mark icon, text is the pending_question in italics
- When route=`error`/retry: shows small amber retry counter badge above the bubble
- Streaming effect: agent response text types character-by-character (simulate with JS interval)
- Input: full-width text area, single-line, rounded, with keyboard shortcut hint (Enter = send)
- 5 quick-send preset buttons below input (one per route type for demo convenience):
  - "Reset my password" (→ simple)
  - "Order status #12345" (→ tool)
  - "Fix it please" (→ missing_info)
  - "Refund customer and email" (→ risky)
  - "System timeout error" (→ error)

### 3. Metrics Panel (RIGHT)
- **Route badge**: large pill, colored by route, with route name centered in Space Grotesk bold
- **4 metric cards** in a 2×2 grid:
  - Nodes Visited: big number + "nodes" label
  - Latency: big number + "ms" label
  - Retries: big number + "×" label
  - Interrupts: big number + "HITL" label
- Numbers animate (count up) when a new result arrives
- **Event log**: scrollable list of events, each showing:
  - `[node_name]` in JetBrains Mono, colored by node type
  - event_type (small, muted)
  - message (truncated at 60 chars)
  - Newest event at top, fades in from top

### 4. Header
- Left: "⬡ LangGraph Agent" (use unicode hexagon as logo substitute)
- Center: Thread ID badge (`thread-S01_simple` style, mono font, small)
- Right: Status dot (pulsing green = active, solid gray = idle) + "Support Agent v1"

---

## INTERACTION & ANIMATION SPEC

### Graph trace animation (the signature moment)
When user sends a message:
1. All nodes reset to `idle` state instantly
2. `intake` node lights up (--accent-graph, pulsing ring) — 300ms
3. `classify` node lights up — 600ms after intake
4. Route decision label appears between classify and the next node — 900ms
5. Subsequent nodes light up sequentially based on the mock route — 400ms each
6. Final node (`finalize`) completes with a brief "done" flash — all nodes solid
7. Total animation time: ~2-3 seconds for a simple route, ~4-5 for retry loop

### Micro-interactions
- Input field: border glow `--accent-graph` on focus
- Send button: subtle scale(0.97) on click, scale(1) on release
- Metric numbers: count up animation (60fps, ease-out, 800ms)
- Node hover in trace: reveal tooltip with node description
- Route badge: slide-in from right, previous badge fades out

### Reduced motion
Wrap all animations in `@media (prefers-reduced-motion: reduce)` — instant state changes, no transitions.

---

## MOCK DATA TO IMPLEMENT

Simulate these 5 complete scenarios cycling through the quick-send buttons:

```javascript
const MOCK_SCENARIOS = {
  simple: {
    route: "simple",
    nodes_visited: 4,
    latency_ms: 842,
    retry_count: 0,
    interrupt_count: 0,
    events: [
      { node: "intake", event_type: "completed", message: "query normalized" },
      { node: "classify", event_type: "completed", message: "route=simple reasoning=General how-to question" },
      { node: "answer", event_type: "completed", message: "answer_length=312" },
      { node: "finalize", event_type: "completed", message: "workflow finished" }
    ],
    final_answer: "To reset your password, go to the login page and click 'Forgot Password'. Enter your email address and check your inbox for a reset link. The link expires in 24 hours."
  },
  tool: {
    route: "tool",
    nodes_visited: 6,
    latency_ms: 1247,
    retry_count: 0,
    interrupt_count: 0,
    events: [
      { node: "intake", event_type: "completed", message: "query normalized" },
      { node: "classify", event_type: "completed", message: "route=tool reasoning=Order lookup required" },
      { node: "tool", event_type: "executed", message: "SUCCESS: order_id=12345 status=shipped eta=2024-12-25" },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=success" },
      { node: "answer", event_type: "completed", message: "answer_length=198" },
      { node: "finalize", event_type: "completed", message: "workflow finished" }
    ],
    final_answer: "Order #12345 is currently shipped and expected to arrive by December 25, 2024. Tracking: ETA confirmed."
  },
  missing_info: {
    route: "missing_info",
    nodes_visited: 4,
    latency_ms: 623,
    retry_count: 0,
    interrupt_count: 0,
    events: [
      { node: "intake", event_type: "completed", message: "query normalized" },
      { node: "classify", event_type: "completed", message: "route=missing_info reasoning=Vague query lacks context" },
      { node: "clarify", event_type: "completed", message: "clarification_requested" },
      { node: "finalize", event_type: "completed", message: "workflow finished" }
    ],
    pending_question: "I'd like to help! Could you clarify what specifically needs to be fixed? What system, account, or feature are you referring to?"
  },
  risky: {
    route: "risky",
    nodes_visited: 8,
    latency_ms: 1891,
    retry_count: 0,
    interrupt_count: 1,
    events: [
      { node: "intake", event_type: "completed", message: "query normalized" },
      { node: "classify", event_type: "completed", message: "route=risky risk_level=high" },
      { node: "risky_action", event_type: "prepared", message: "awaiting_approval" },
      { node: "approval", event_type: "completed", message: "approved=True" },
      { node: "tool", event_type: "executed", message: "SUCCESS: refund processed, email queued" },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=success" },
      { node: "answer", event_type: "completed", message: "answer_length=241" },
      { node: "finalize", event_type: "completed", message: "workflow finished" }
    ],
    proposed_action: "PROPOSED: Refund customer and send confirmation email. This has financial and communication side effects.",
    final_answer: "Refund has been processed and a confirmation email has been sent to the customer. Action approved by mock-reviewer."
  },
  error: {
    route: "error",
    nodes_visited: 9,
    latency_ms: 3124,
    retry_count: 2,
    interrupt_count: 0,
    events: [
      { node: "intake", event_type: "completed", message: "query normalized" },
      { node: "classify", event_type: "completed", message: "route=error reasoning=System timeout detected" },
      { node: "retry", event_type: "incremented", message: "attempt=1" },
      { node: "tool", event_type: "executed", message: "ERROR: Tool timeout on attempt 1" },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=needs_retry" },
      { node: "retry", event_type: "incremented", message: "attempt=2" },
      { node: "tool", event_type: "executed", message: "SUCCESS: Recovered on attempt 2" },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=success" },
      { node: "answer", event_type: "completed", message: "answer_length=178" },
      { node: "finalize", event_type: "completed", message: "workflow finished" }
    ],
    final_answer: "The timeout issue has been resolved after 2 retry attempts. The request completed successfully on the second try."
  }
};
```

---

## ADDITIONAL REQUIREMENTS

### Code quality
- All CSS in `style.css` — no inline styles except for dynamic JS-driven values
- All JS in `app.js` — no external dependencies, vanilla JS only
- index.html imports only Google Fonts, style.css, app.js
- Responsive: works at 320px, 768px, 1280px, 1920px
- Keyboard: Tab navigation works, Enter submits, Escape clears input
- `aria-label` on all interactive elements

### Integration readiness (for README.md)
Document exactly:
- Where to wire in a real fetch() call to replace mock data
- What JSON shape the backend should return (matches `ScenarioMetric` from metrics.py)
- How to add a WebSocket/SSE for streaming node state updates

### DO NOT include
- Any Python, Flask, FastAPI, or backend code
- Any npm, webpack, or build tool dependencies
- Placeholder images (use CSS/SVG patterns if needed)
- Generic hero sections, landing page copy, or marketing language

---

## SELF-CRITIQUE CHECKLIST (run before finalizing)

Before submitting, verify:
- [ ] The graph trace panel animates correctly for all 5 mock scenarios
- [ ] Each route has a visually distinct color treatment (not just text change)
- [ ] The risky route shows the approval gate UI (Approve/Reject buttons)
- [ ] Font sizes use only the defined type scale variables
- [ ] Colors use only the defined CSS custom properties
- [ ] No three AI-default patterns (cream+terracotta, acid-green, newspaper columns)
- [ ] Responsive layout tested at 768px and 320px
- [ ] Metrics count-up animation works on each new scenario
- [ ] Event log scrolls smoothly with newest events at top
- [ ] The "signature element" (animated graph trace) is the most memorable part
- [ ] Remove any decoration that does not serve the brief (Chanel rule)
