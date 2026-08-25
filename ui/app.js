/**
 * LangGraph Support-Ticket Agent — Frontend Logic & Observability Controller
 * Features:
 *  - 11-node graph trace animation state machine
 *  - Human-in-the-Loop (HITL) approval gate pause & resume
 *  - Typewriter character-by-character message streaming
 *  - Smooth 60fps ease-out count-up metric telemetry
 *  - Interactive event audit logger & payload inspector
 *  - Scenario preset matching & custom prompt intent routing
 */

// -----------------------------------------------------------------------------
// 1. Graph Definition & Node Metadata
// -----------------------------------------------------------------------------
const GRAPH_NODES = [
  { id: "intake", name: "intake", label: "Intake & Normalize", tag: "GATEWAY", desc: "Validate input format & sanitize query" },
  { id: "classify", name: "classify", label: "Classify Route", tag: "ROUTER", desc: "LLM semantic intent classification" },
  { id: "tool", name: "tool", label: "Tool Execution", tag: "ACTION", desc: "Query database or third-party service" },
  { id: "evaluate", name: "evaluate", label: "Evaluate Output", tag: "CRITIC", desc: "Verify response schema & tool output" },
  { id: "answer", name: "answer", label: "Synthesize Answer", tag: "OUTPUT", desc: "Draft final human-friendly response" },
  { id: "clarify", name: "clarify", label: "Request Info", tag: "CLARIFY", desc: "Prompt user for missing parameters" },
  { id: "risky_action", name: "risky_action", label: "Prepare Risky Action", tag: "SAFETY", desc: "Stage high-risk side-effects" },
  { id: "approval", name: "approval", label: "HITL Approval Gate", tag: "CHECKPOINT", desc: "Pause thread for human sign-off" },
  { id: "retry", name: "retry", label: "Retry / Backoff", tag: "HEALING", desc: "Increment attempt & compute backoff" },
  { id: "dead_letter", name: "dead_letter", label: "Dead Letter Queue", tag: "FALLBACK", desc: "Escalate unrecoverable failures" },
  { id: "finalize", name: "finalize", label: "Finalize State", tag: "TERMINUS", desc: "Persist checkpoint & compute metrics" }
];

// -----------------------------------------------------------------------------
// 2. Backend API Client
// -----------------------------------------------------------------------------
const API_BASE = "";

const ROUTE_LABELS = {
  simple: "SIMPLE ROUTE",
  tool: "TOOL EXECUTION",
  missing_info: "MISSING INFO",
  risky: "RISKY (HITL APPROVAL)",
  error: "ERROR (RETRY LOOP)",
};

async function postJSON(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Server error (${response.status}): ${detail}`);
  }
  return response.json();
}

function sendQueryToBackend(query, threadId) {
  return postJSON("/api/chat", { query, thread_id: threadId });
}

function sendApprovalToBackend(threadId, decision) {
  return postJSON("/api/chat/approval", { thread_id: threadId, decision });
}

// -----------------------------------------------------------------------------
// 3. Application State & DOM References
// -----------------------------------------------------------------------------
const state = {
  isBusy: false,
  activeScenario: null,
  activeRoute: null,
  activeNode: null,
  threadId: "thread-idle",
  metrics: {
    nodes_visited: 0,
    latency_ms: 0,
    retry_count: 0,
    interrupt_count: 0
  },
  events: [],
  pendingApproval: null,
  typingInterval: null
};

const dom = {
  threadIdText: document.getElementById("threadIdText"),
  statusIndicator: document.getElementById("statusIndicator"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  graphTraceChain: document.getElementById("graphTraceChain"),
  chatStream: document.getElementById("chatStream"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  sendBtn: document.getElementById("sendBtn"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  presetBtns: document.querySelectorAll(".preset-btn"),
  activeRouteBadge: document.getElementById("activeRouteBadge"),
  activeRouteName: document.getElementById("activeRouteName"),
  valNodesVisited: document.getElementById("valNodesVisited"),
  valLatency: document.getElementById("valLatency"),
  valRetries: document.getElementById("valRetries"),
  valInterrupts: document.getElementById("valInterrupts"),
  eventLogContainer: document.getElementById("eventLogContainer"),
  eventLogEmpty: document.getElementById("eventLogEmpty"),
  eventCountBadge: document.getElementById("eventCountBadge"),
  inspectorOverlay: document.getElementById("inspectorOverlay"),
  inspectorCloseBtn: document.getElementById("inspectorCloseBtn"),
  inspectorNodeTag: document.getElementById("inspectorNodeTag"),
  inspectorTitle: document.getElementById("inspectorTitle"),
  inspectorEventType: document.getElementById("inspectorEventType"),
  inspectorNodeStatus: document.getElementById("inspectorNodeStatus"),
  inspectorMessage: document.getElementById("inspectorMessage"),
  inspectorJsonCode: document.getElementById("inspectorJsonCode"),
  mobileTraceToggle: document.getElementById("mobileTraceToggle"),
  mobileMetricsToggle: document.getElementById("mobileMetricsToggle"),
  graphPanel: document.getElementById("graphPanel"),
  metricsPanel: document.getElementById("metricsPanel")
};

// -----------------------------------------------------------------------------
// 4. Initialization
// -----------------------------------------------------------------------------
function initApp() {
  renderInitialGraphTrace();
  bindEvents();
}

/**
 * Render the static 11-node chain in the Graph Trace panel
 */
function renderInitialGraphTrace() {
  dom.graphTraceChain.innerHTML = "";
  GRAPH_NODES.forEach((node, index) => {
    const nodeEl = document.createElement("div");
    nodeEl.className = "trace-node idle";
    nodeEl.id = `trace-node-${node.id}`;
    nodeEl.setAttribute("data-node-id", node.id);
    nodeEl.setAttribute("tabindex", "0");
    nodeEl.setAttribute("role", "button");
    nodeEl.setAttribute("aria-label", `Inspect node ${node.name}: ${node.label}`);

    nodeEl.innerHTML = `
      <div class="node-indicator">${index + 1}</div>
      <div class="node-details">
        <div class="node-name-row">
          <span class="node-name">${node.name}</span>
          <span class="node-tag">${node.tag}</span>
        </div>
        <span class="node-desc">${node.label}</span>
      </div>
    `;

    // Click to open inspector
    nodeEl.addEventListener("click", () => inspectNode(node.id));
    nodeEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inspectNode(node.id);
      }
    });

    dom.graphTraceChain.appendChild(nodeEl);
  });
}

// -----------------------------------------------------------------------------
// 5. Event Listeners & Interactions
// -----------------------------------------------------------------------------
function bindEvents() {
  // Preset buttons
  dom.presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.isBusy) return;
      const query = btn.getAttribute("data-query");
      if (query) {
        handleCustomQuery(query);
      }
    });
  });

  // Chat Form Submit
  dom.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.isBusy) return;
    const query = dom.chatInput.value.trim();
    if (!query) return;
    handleCustomQuery(query);
  });

  // Chat Input Keyboard Shortcuts
  dom.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dom.chatInput.value = "";
    }
  });

  // Clear / Reset Button
  dom.clearChatBtn.addEventListener("click", () => {
    resetConversation();
  });

  // Inspector Close
  dom.inspectorCloseBtn.addEventListener("click", closeInspector);
  dom.inspectorOverlay.addEventListener("click", (e) => {
    if (e.target === dom.inspectorOverlay) closeInspector();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dom.inspectorOverlay.classList.contains("open")) {
      closeInspector();
    }
  });

  // Mobile Toggles
  if (dom.mobileTraceToggle) {
    dom.mobileTraceToggle.addEventListener("click", () => {
      dom.graphPanel.classList.toggle("mobile-open");
      dom.metricsPanel.classList.remove("mobile-open");
    });
  }
  if (dom.mobileMetricsToggle) {
    dom.mobileMetricsToggle.addEventListener("click", () => {
      dom.metricsPanel.classList.toggle("mobile-open");
      dom.graphPanel.classList.remove("mobile-open");
    });
  }
}

// -----------------------------------------------------------------------------
// 6. Custom Query Submission
// -----------------------------------------------------------------------------
function handleCustomQuery(query) {
  dom.chatInput.value = "";
  executeQuery(query);
}

// -----------------------------------------------------------------------------
// 7. Live Query Execution & Workflow Orchestration
// -----------------------------------------------------------------------------
async function executeQuery(query) {
  state.isBusy = true;
  state.threadId = `thread-${Date.now().toString(36)}`;

  dom.threadIdText.textContent = state.threadId;
  setSystemStatus("active", "Invoking LangGraph...");
  setSendDisabled(true);

  appendUserMessage(query);
  resetGraphTraceVisuals();

  let res;
  try {
    res = await sendQueryToBackend(query, state.threadId);
  } catch (err) {
    appendAgentMessage(`Connection error: ${err.message}`, "error");
    setSystemStatus("idle", "Backend Unreachable");
    setSendDisabled(false);
    state.isBusy = false;
    return;
  }

  updateRouteBadge(res.route, ROUTE_LABELS[res.route] || (res.route || "").toUpperCase());
  await animateEvents(res.events, res.thread_id, res.route);

  const waitingForApproval = res.route === "risky" && !res.final_answer && !res.pending_question;

  if (waitingForApproval) {
    setNodeState("approval", "risky-active");
    setSystemStatus("awaiting", "Awaiting HITL Approval");
    animateMetrics(pickMetrics(res));

    const decision = await new Promise((resolve) => {
      appendApprovalGateCard(res.proposed_action, resolve);
    });

    setSystemStatus("active", "Resuming Graph Execution...");
    let resumed;
    try {
      resumed = await sendApprovalToBackend(res.thread_id, decision);
    } catch (err) {
      appendAgentMessage(`Connection error: ${err.message}`, "error");
      setSystemStatus("idle", "Backend Unreachable");
      setSendDisabled(false);
      state.isBusy = false;
      return;
    }

    const newEvents = resumed.events.slice(res.events.length);
    await animateEvents(newEvents, resumed.thread_id, resumed.route);
    markUnvisitedNodesSkipped(resumed.events.map(e => e.node));
    animateMetrics(pickMetrics(resumed));
    renderFinalMessage(resumed);
    setSystemStatus("idle", decision === "approve" ? "Action Executed & Approved" : "Halted (Rejected)");
  } else {
    markUnvisitedNodesSkipped(res.events.map(e => e.node));
    animateMetrics(pickMetrics(res));
    renderFinalMessage(res);
    setSystemStatus("idle", "Workflow Finished");
  }

  setSendDisabled(false);
  state.isBusy = false;
}

function pickMetrics(res) {
  return {
    nodes_visited: res.nodes_visited,
    latency_ms: res.latency_ms,
    retry_count: res.retry_count,
    interrupt_count: res.interrupt_count,
  };
}

function renderFinalMessage(res) {
  if (res.pending_question) {
    appendClarificationMessage(res.pending_question, res.route);
  } else if (res.retry_count > 0) {
    appendErrorMessage(res.final_answer, res.retry_count, res.route);
  } else {
    appendAgentMessage(res.final_answer, res.route);
  }
}

/**
 * Animate a run of backend-reported events onto the graph trace, in order.
 */
async function animateEvents(events, threadId, route) {
  for (const event of events) {
    const nodeId = event.node;
    setNodeState(nodeId, "active");
    await sleep(getStepDelay(350));

    if (nodeId === "classify") {
      insertBranchBadge(route);
    }

    recordEvent(event, threadId);
    setNodeState(nodeId, "completed");
  }
}

// -----------------------------------------------------------------------------
// 8. Graph Trace State Machine
// -----------------------------------------------------------------------------
function setNodeState(nodeId, newState) {
  const nodeEl = document.getElementById(`trace-node-${nodeId}`);
  if (!nodeEl) return;

  nodeEl.classList.remove("idle", "active", "completed", "skipped", "risky-active", "retry-active");
  nodeEl.classList.add(newState);

  const indicator = nodeEl.querySelector(".node-indicator");
  if (indicator) {
    if (newState === "completed") {
      indicator.innerHTML = "✓";
    } else if (newState === "skipped") {
      indicator.innerHTML = "—";
    } else if (newState === "risky-active") {
      indicator.innerHTML = "!";
    } else {
      const idx = GRAPH_NODES.findIndex(n => n.id === nodeId);
      indicator.innerHTML = (idx + 1).toString();
    }
  }

  state.activeNode = nodeId;
}

function resetGraphTraceVisuals() {
  GRAPH_NODES.forEach((node, index) => {
    const nodeEl = document.getElementById(`trace-node-${node.id}`);
    if (nodeEl) {
      nodeEl.className = "trace-node idle";
      const indicator = nodeEl.querySelector(".node-indicator");
      if (indicator) indicator.innerHTML = (index + 1).toString();
    }
  });

  // Remove existing branch decision badge
  const existingBadge = document.querySelector(".trace-branch-badge");
  if (existingBadge) existingBadge.remove();
}

function insertBranchBadge(route) {
  const classifyNode = document.getElementById("trace-node-classify");
  if (!classifyNode) return;

  // Remove any old badge
  const existingBadge = document.querySelector(".trace-branch-badge");
  if (existingBadge) existingBadge.remove();

  const badge = document.createElement("div");
  badge.className = `trace-branch-badge ${route}`;
  badge.innerHTML = `<span>→ route: ${route}</span>`;

  classifyNode.after(badge);
}

function markUnvisitedNodesSkipped(visitedList) {
  GRAPH_NODES.forEach(node => {
    if (!visitedList.includes(node.id)) {
      setNodeState(node.id, "skipped");
    }
  });
}

// -----------------------------------------------------------------------------
// 9. Chat Stream & Typewriter Engine
// -----------------------------------------------------------------------------
function appendUserMessage(text) {
  removeWelcomeIfNeeded();

  const msgWrap = document.createElement("div");
  msgWrap.className = "message-wrapper user";
  msgWrap.innerHTML = `
    <div class="message-bubble user-bubble">
      <div class="bubble-header">
        <span class="sender-name">Operator</span>
        <span class="bubble-timestamp">${getCurrentTime()}</span>
      </div>
      <div class="bubble-content">${escapeHTML(text)}</div>
    </div>
  `;
  dom.chatStream.appendChild(msgWrap);
  scrollToBottom();
}

function appendAgentMessage(text, route) {
  removeWelcomeIfNeeded();

  const msgWrap = document.createElement("div");
  msgWrap.className = "message-wrapper agent";

  const bubble = document.createElement("div");
  bubble.className = `message-bubble agent-bubble route-${route}`;
  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="sender-name">LangGraph Agent</span>
      <span class="bubble-timestamp">${getCurrentTime()}</span>
    </div>
    <div class="bubble-content"><span class="typewriter-target"></span><span class="typewriter-cursor"></span></div>
  `;

  msgWrap.innerHTML = `<div class="agent-avatar" aria-hidden="true">⬡</div>`;
  msgWrap.appendChild(bubble);
  dom.chatStream.appendChild(msgWrap);
  scrollToBottom();

  const targetSpan = bubble.querySelector(".typewriter-target");
  const cursor = bubble.querySelector(".typewriter-cursor");

  streamText(text, targetSpan, cursor);
}

function appendClarificationMessage(questionText, route) {
  removeWelcomeIfNeeded();

  const msgWrap = document.createElement("div");
  msgWrap.className = "message-wrapper agent";

  const bubble = document.createElement("div");
  bubble.className = `message-bubble agent-bubble route-${route}`;
  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="sender-name">LangGraph Agent (Clarification)</span>
      <span class="bubble-timestamp">${getCurrentTime()}</span>
    </div>
    <div class="bubble-content">
      <div class="pending-question-text">
        <span class="question-icon-badge">?</span>
        <div>
          <span class="typewriter-target"></span><span class="typewriter-cursor"></span>
        </div>
      </div>
    </div>
  `;

  msgWrap.innerHTML = `<div class="agent-avatar" aria-hidden="true">⬡</div>`;
  msgWrap.appendChild(bubble);
  dom.chatStream.appendChild(msgWrap);
  scrollToBottom();

  const targetSpan = bubble.querySelector(".typewriter-target");
  const cursor = bubble.querySelector(".typewriter-cursor");

  streamText(questionText, targetSpan, cursor);
}

function appendErrorMessage(text, retryCount, route) {
  removeWelcomeIfNeeded();

  const msgWrap = document.createElement("div");
  msgWrap.className = "message-wrapper agent";

  const bubble = document.createElement("div");
  bubble.className = `message-bubble agent-bubble route-${route}`;
  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="sender-name">LangGraph Agent (Self-Healing)</span>
      <span class="bubble-timestamp">${getCurrentTime()}</span>
    </div>
    <div class="retry-badge-callout">
      <span>⚡ Auto-recovered after ${retryCount} retries</span>
    </div>
    <div class="bubble-content"><span class="typewriter-target"></span><span class="typewriter-cursor"></span></div>
  `;

  msgWrap.innerHTML = `<div class="agent-avatar" aria-hidden="true">⬡</div>`;
  msgWrap.appendChild(bubble);
  dom.chatStream.appendChild(msgWrap);
  scrollToBottom();

  const targetSpan = bubble.querySelector(".typewriter-target");
  const cursor = bubble.querySelector(".typewriter-cursor");

  streamText(text, targetSpan, cursor);
}

function appendApprovalGateCard(proposedAction, callback) {
  removeWelcomeIfNeeded();

  const msgWrap = document.createElement("div");
  msgWrap.className = "message-wrapper agent";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble agent-bubble route-risky";
  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="sender-name">LangGraph Agent (HITL Gate)</span>
      <span class="bubble-timestamp">${getCurrentTime()}</span>
    </div>
    <div class="approval-gate-card">
      <div class="approval-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span>Human Review Required</span>
      </div>
      <div class="approval-body">
        <p>${escapeHTML(proposedAction)}</p>
      </div>
      <div class="approval-actions" id="approvalBtnGroup">
        <button class="btn-approve" id="btnApprove" aria-label="Approve risky action">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Approve Action</span>
        </button>
        <button class="btn-reject" id="btnReject" aria-label="Reject risky action">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          <span>Reject</span>
        </button>
      </div>
    </div>
  `;

  msgWrap.innerHTML = `<div class="agent-avatar" aria-hidden="true">⬡</div>`;
  msgWrap.appendChild(bubble);
  dom.chatStream.appendChild(msgWrap);
  scrollToBottom();

  const btnApprove = bubble.querySelector("#btnApprove");
  const btnReject = bubble.querySelector("#btnReject");
  const btnGroup = bubble.querySelector("#approvalBtnGroup");

  btnApprove.addEventListener("click", () => {
    btnGroup.innerHTML = `
      <div class="approval-decided-banner approved">
        ✓ Action approved by mock-reviewer at ${getCurrentTime()}
      </div>
    `;
    callback("approve");
  });

  btnReject.addEventListener("click", () => {
    btnGroup.innerHTML = `
      <div class="approval-decided-banner rejected">
        ✕ Action rejected by mock-reviewer at ${getCurrentTime()}
      </div>
    `;
    callback("reject");
  });
}

function streamText(text, targetEl, cursorEl) {
  // If reduced motion is requested, render instantly
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    targetEl.textContent = text;
    if (cursorEl) cursorEl.remove();
    scrollToBottom();
    return;
  }

  let index = 0;
  const speedMs = 18;
  const interval = setInterval(() => {
    if (index < text.length) {
      targetEl.textContent += text[index];
      index++;
      scrollToBottom();
    } else {
      clearInterval(interval);
      if (cursorEl) cursorEl.remove();
    }
  }, speedMs);
}

function removeWelcomeIfNeeded() {
  const welcome = document.getElementById("welcomeMessage");
  if (welcome) {
    welcome.style.opacity = "0.6";
  }
}

function scrollToBottom() {
  dom.chatStream.scrollTop = dom.chatStream.scrollHeight;
}

// -----------------------------------------------------------------------------
// 10. Metrics & Telemetry Animation
// -----------------------------------------------------------------------------
function updateRouteBadge(route, label) {
  dom.activeRouteBadge.className = `route-badge ${route}`;
  dom.activeRouteName.textContent = label || route.toUpperCase();
}

function animateMetrics(newMetrics) {
  animateCountUp(dom.valNodesVisited, state.metrics.nodes_visited, newMetrics.nodes_visited, 600);
  animateCountUp(dom.valLatency, state.metrics.latency_ms, newMetrics.latency_ms, 800);
  animateCountUp(dom.valRetries, state.metrics.retry_count, newMetrics.retry_count, 500);
  animateCountUp(dom.valInterrupts, state.metrics.interrupt_count, newMetrics.interrupt_count, 500);

  state.metrics = { ...newMetrics };
}

function animateCountUp(element, startVal, endVal, durationMs) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = endVal;
    return;
  }

  const startTime = performance.now();

  function updateNumber(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    // Ease-out cubic
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const currentNumber = Math.round(startVal + (endVal - startVal) * easeProgress);

    element.textContent = currentNumber;

    if (progress < 1) {
      requestAnimationFrame(updateNumber);
    } else {
      element.textContent = endVal;
    }
  }

  requestAnimationFrame(updateNumber);
}

// -----------------------------------------------------------------------------
// 11. Event Audit Logger & Node Inspector
// -----------------------------------------------------------------------------
function recordEvent(eventData, threadId) {
  if (dom.eventLogEmpty) {
    dom.eventLogEmpty.style.display = "none";
  }

  const fullEvent = {
    ...eventData,
    thread_id: threadId,
    timestamp: getCurrentTime()
  };

  state.events.unshift(fullEvent);
  dom.eventCountBadge.textContent = `${state.events.length} events`;

  const itemEl = document.createElement("div");
  itemEl.className = "event-log-item";
  itemEl.setAttribute("tabindex", "0");
  itemEl.setAttribute("role", "button");
  itemEl.setAttribute("aria-label", `Event on node ${eventData.node}: ${eventData.message}`);

  itemEl.innerHTML = `
    <div class="event-meta-row">
      <span class="event-node-tag ${eventData.node}">[${eventData.node}]</span>
      <span class="event-type-label">${eventData.event_type}</span>
    </div>
    <div class="event-message" title="${escapeHTML(eventData.message)}">
      ${escapeHTML(eventData.message)}
    </div>
  `;

  itemEl.addEventListener("click", () => showInspectorWithEvent(fullEvent));
  itemEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showInspectorWithEvent(fullEvent);
    }
  });

  dom.eventLogContainer.insertBefore(itemEl, dom.eventLogContainer.firstChild);
}

function inspectNode(nodeId) {
  const nodeDef = GRAPH_NODES.find(n => n.id === nodeId);
  if (!nodeDef) return;

  // Find recent event for this node
  const recentEvent = state.events.find(e => e.node === nodeId);

  let payload = {};
  let statusText = "Idle / Not executed in current scenario";
  let eventType = "none";
  let msg = nodeDef.desc;

  if (recentEvent) {
    statusText = "Completed / Audited";
    eventType = recentEvent.event_type;
    msg = recentEvent.message;
    payload = {
      node: nodeId,
      thread_id: recentEvent.thread_id,
      event_type: recentEvent.event_type,
      latency_ms: recentEvent.latency_ms || 0,
      timestamp: recentEvent.timestamp,
      metadata: recentEvent.metadata || {},
      node_definition: {
        tag: nodeDef.tag,
        label: nodeDef.label,
        description: nodeDef.desc
      }
    };
  } else {
    payload = {
      node: nodeId,
      thread_id: state.threadId,
      status: "unvisited",
      node_definition: {
        tag: nodeDef.tag,
        label: nodeDef.label,
        description: nodeDef.desc
      }
    };
  }

  dom.inspectorNodeTag.textContent = `[${nodeId}]`;
  dom.inspectorTitle.textContent = `${nodeDef.name} — ${nodeDef.label}`;
  dom.inspectorEventType.textContent = eventType;
  dom.inspectorNodeStatus.textContent = statusText;
  dom.inspectorMessage.textContent = msg;
  dom.inspectorJsonCode.textContent = JSON.stringify(payload, null, 2);

  openInspector();
}

function showInspectorWithEvent(fullEvent) {
  const nodeDef = GRAPH_NODES.find(n => n.id === fullEvent.node) || { label: fullEvent.node, tag: "AUDIT", desc: "" };

  dom.inspectorNodeTag.textContent = `[${fullEvent.node}]`;
  dom.inspectorTitle.textContent = `${fullEvent.node} Event`;
  dom.inspectorEventType.textContent = fullEvent.event_type;
  dom.inspectorNodeStatus.textContent = "Recorded in State Checkpoint";
  dom.inspectorMessage.textContent = fullEvent.message;
  dom.inspectorJsonCode.textContent = JSON.stringify(fullEvent, null, 2);

  openInspector();
}

function openInspector() {
  dom.inspectorOverlay.classList.add("open");
  dom.inspectorOverlay.setAttribute("aria-hidden", "false");
}

function closeInspector() {
  dom.inspectorOverlay.classList.remove("open");
  dom.inspectorOverlay.setAttribute("aria-hidden", "true");
}

// -----------------------------------------------------------------------------
// 12. Helper Functions
// -----------------------------------------------------------------------------
function setSystemStatus(type, label) {
  dom.statusIndicator.className = `status-indicator ${type}`;
  dom.statusText.textContent = label;
}

function setSendDisabled(disabled) {
  dom.sendBtn.disabled = disabled;
  dom.presetBtns.forEach(btn => {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.5" : "1";
    btn.style.cursor = disabled ? "not-allowed" : "pointer";
  });
}

function resetConversation() {
  state.isBusy = false;
  state.activeScenario = null;
  state.activeRoute = null;
  state.threadId = "thread-idle";
  state.events = [];
  state.metrics = { nodes_visited: 0, latency_ms: 0, retry_count: 0, interrupt_count: 0 };

  dom.threadIdText.textContent = "thread-idle";
  setSystemStatus("idle", "System Ready");
  updateRouteBadge("idle", "IDLE / STANDBY");

  dom.valNodesVisited.textContent = "0";
  dom.valLatency.textContent = "0";
  dom.valRetries.textContent = "0";
  dom.valInterrupts.textContent = "0";

  dom.eventLogContainer.innerHTML = `
    <div class="event-log-empty" id="eventLogEmpty">
      <span>No events recorded yet. Run a scenario to inspect execution events.</span>
    </div>
  `;
  dom.eventLogEmpty = document.getElementById("eventLogEmpty");
  dom.eventCountBadge.textContent = "0 events";

  dom.chatStream.innerHTML = `
    <div class="message-wrapper agent" id="welcomeMessage">
      <div class="agent-avatar" aria-hidden="true">⬡</div>
      <div class="message-bubble agent-bubble welcome-bubble">
        <div class="bubble-header">
          <span class="sender-name">LangGraph Agent</span>
          <span class="bubble-timestamp">System Init</span>
        </div>
        <div class="bubble-content">
          <p>Welcome to the <strong>LangGraph Support-Ticket Observatory</strong>. This interface visualizes conditional node routing, tool calls, retry self-healing, and Human-in-the-Loop (HITL) safety gates in real-time.</p>
          <p class="welcome-tip">Select a preset scenario below or type a custom ticket inquiry to observe the graph trace execution.</p>
        </div>
      </div>
    </div>
  `;

  resetGraphTraceVisuals();
  setSendDisabled(false);
}

function getCurrentTime() {
  const now = new Date();
  return now.toTimeString().split(" ")[0];
}

function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStepDelay(baseMs) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return 10;
  }
  return baseMs;
}

// Start application
document.addEventListener("DOMContentLoaded", initApp);
