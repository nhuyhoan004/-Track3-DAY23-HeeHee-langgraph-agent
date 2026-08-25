# LangGraph Support-Ticket Agent — Frontend Integration Guide

This directory contains the standalone, high-fidelity frontend observatory for the LangGraph Support-Ticket Agent lab.

---

## 📁 File Structure

- `index.html` — Semantic 3-panel UI layout (Graph Trace, Chat Console, Telemetry & Audit Log).
- `style.css` — Token-driven stylesheet utilizing custom CSS variables, keyframe animations, and responsive breakpoints.
- `app.js` — Client-side orchestration logic, 11-node graph trace state machine, HITL approval gate, typewriter streaming engine, and event inspector.
- `README.md` — Integration specifications for connecting to a live LangGraph backend.

---

## 🎨 Design System & Token Specifications

| Token | Value | Semantic Role |
| :--- | :--- | :--- |
| `--bg-void` | `#0A0C10` | Near-black terminal canvas |
| `--bg-surface` | `#111318` | Card & panel background |
| `--bg-elevated` | `#1C1F28` | Inputs, hover states, user chat bubbles |
| `--accent-graph` | `#4FDFB2` | Teal-mint signal color for active nodes & graph trace |
| `--accent-risky` | `#FF6B6B` | Coral-red for risky routes & HITL approval gate |
| `--accent-tool` | `#7C9EFF` | Periwinkle for tool executions & data lookups |
| `--accent-simple` | `#A8E6A3` | Sage green for simple route direct responses |
| `--accent-error` | `#FFB347` | Amber for retry states & self-healing loops |
| `--text-primary` | `#E8EAF0` | Crisp high-contrast body text |
| `--text-muted` | `#6B7280` | Secondary labels, node tags, timestamps |
| `--border-dim` | `#1E2330` | Structural panel dividers |

### Typography
- **Display**: `Space Grotesk` (weights 400, 600, 700) — Headers, route badges, node labels, telemetry numbers.
- **Body**: `Inter` (weights 400, 500, 600) — Message copy, form controls, captions.
- **Mono**: `JetBrains Mono` (weights 400, 600) — Thread IDs, state JSON payloads, event audit logs, latencies.

---

## 🔌 Backend Integration Specification

### 1. REST Endpoint (`POST /api/chat`)

To connect a live FastAPI/Flask LangGraph server, replace `executeScenario(scenario)` in `app.js` with a live REST invocation:

```javascript
async function sendQueryToBackend(query, threadId) {
  setSystemStatus("active", "Invoking LangGraph...");
  
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: query,
      thread_id: threadId || `thread-${Date.now()}`
    })
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}
```

### 2. Expected JSON Response Schema

The backend response payload directly maps to `AgentState` and `ScenarioMetric`:

```json
{
  "scenario_id": "S02_tool",
  "thread_id": "thread-S02_tool",
  "route": "tool",
  "success": true,
  "nodes_visited": 6,
  "latency_ms": 1247,
  "retry_count": 0,
  "interrupt_count": 0,
  "approval_required": false,
  "approval_observed": false,
  "final_answer": "Order #12345 is currently shipped and expected to arrive by December 25, 2024. Tracking: ETA confirmed.",
  "pending_question": null,
  "proposed_action": null,
  "events": [
    {
      "node": "intake",
      "event_type": "completed",
      "message": "query normalized",
      "latency_ms": 115,
      "metadata": { "order_id": "12345" }
    },
    {
      "node": "classify",
      "event_type": "completed",
      "message": "route=tool reasoning=Order lookup required",
      "latency_ms": 295,
      "metadata": { "confidence": 0.96 }
    },
    {
      "node": "tool",
      "event_type": "executed",
      "message": "SUCCESS: order_id=12345 status=shipped eta=2024-12-25",
      "latency_ms": 450,
      "metadata": { "carrier": "FedEx" }
    },
    {
      "node": "evaluate",
      "event_type": "completed",
      "message": "evaluation_result=success",
      "latency_ms": 120,
      "metadata": { "score": 1.0 }
    },
    {
      "node": "answer",
      "event_type": "completed",
      "message": "answer_length=118",
      "latency_ms": 235,
      "metadata": { "model": "gemini-flash" }
    },
    {
      "node": "finalize",
      "event_type": "completed",
      "message": "workflow finished",
      "latency_ms": 32,
      "metadata": { "checkpoint_saved": true }
    }
  ]
}
```

---

## ⚡ Real-Time Streaming via WebSocket or Server-Sent Events (SSE)

For live node-by-node execution updates and token streaming, connect via SSE or WebSockets:

### Server-Sent Events (SSE) Example

```javascript
function streamGraphExecution(query, threadId) {
  const url = `/api/chat/stream?query=${encodeURIComponent(query)}&thread_id=${encodeURIComponent(threadId)}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);

    switch (data.type) {
      case "node_start":
        // Light up node in Graph Trace
        setNodeState(data.node, "active");
        break;

      case "node_end":
        // Mark node completed and log event
        setNodeState(data.node, "completed");
        recordEvent(data.event, threadId);
        break;

      case "approval_required":
        // Pause and trigger HITL Approval Gate
        setNodeState("approval", "risky-active");
        appendApprovalGateCard(data.proposed_action, (decision) => {
          // Send user approval back to server to resume graph
          fetch(`/api/chat/approval`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thread_id: threadId, decision: decision })
          });
        });
        break;

      case "token":
        // Stream text token into chat bubble
        appendStreamingToken(data.token);
        break;

      case "workflow_complete":
        animateMetrics(data.metrics);
        setSystemStatus("idle", "Workflow Finished");
        eventSource.close();
        break;
    }
  };

  eventSource.onerror = (err) => {
    console.error("SSE Connection error:", err);
    eventSource.close();
  };
}
```

---

## 🧪 Verification & Self-Critique Checklist

- [x] **Graph trace animation**: Sequentially animates all 11 nodes based on active execution path.
- [x] **Color encoding**: Every route (`simple`, `tool`, `missing_info`, `risky`, `error`) has an assigned semantic color.
- [x] **Human-in-the-Loop (HITL) gate**: Pauses workflow on `approval` node, renders Approve / Reject card, and resumes upon user action.
- [x] **Strict token compliance**: Only uses predefined type scale and 6-color palette tokens.
- [x] **Zero AI clichés**: No cream/terracotta, no acid-green monochrome terminal, no broadsheet columns.
- [x] **Telemetry count-up**: 60fps ease-out cubic number animations for all 4 metrics.
- [x] **Responsive**: Seamless layout scaling from 320px mobile drawer to 1920px widescreen.
- [x] **Accessibility**: Visible keyboard navigation focus rings, `aria-label` tags, and `prefers-reduced-motion` detection.
