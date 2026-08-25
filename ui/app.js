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
// 2. Mock Scenarios Dataset
// -----------------------------------------------------------------------------
const MOCK_SCENARIOS = {
  simple: {
    id: "S01_simple",
    route: "simple",
    route_label: "SIMPLE ROUTE",
    thread_id: "thread-S01_simple",
    query: "Reset my password",
    nodes_visited: 4,
    latency_ms: 842,
    retry_count: 0,
    interrupt_count: 0,
    node_sequence: ["intake", "classify", "answer", "finalize"],
    events: [
      { node: "intake", event_type: "completed", message: "query normalized: 'Reset my password'", latency_ms: 120, metadata: { cleaned_query: "Reset my password", tokens: 4 } },
      { node: "classify", event_type: "completed", message: "route=simple reasoning='General how-to inquiry'", latency_ms: 280, metadata: { confidence: 0.98, route: "simple" } },
      { node: "answer", event_type: "completed", message: "answer_length=174 chars synthesized", latency_ms: 410, metadata: { model: "gemini-flash", tokens: 48 } },
      { node: "finalize", event_type: "completed", message: "workflow finished, checkpoint saved", latency_ms: 32, metadata: { checkpoint_id: "chk_092a", status: "success" } }
    ],
    final_answer: "To reset your password, go to the login page and click 'Forgot Password'. Enter your email address and check your inbox for a reset link. The link expires in 24 hours."
  },

  tool: {
    id: "S02_tool",
    route: "tool",
    route_label: "TOOL EXECUTION",
    thread_id: "thread-S02_tool",
    query: "Order status #12345",
    nodes_visited: 6,
    latency_ms: 1247,
    retry_count: 0,
    interrupt_count: 0,
    node_sequence: ["intake", "classify", "tool", "evaluate", "answer", "finalize"],
    events: [
      { node: "intake", event_type: "completed", message: "query normalized: 'Order status #12345'", latency_ms: 115, metadata: { order_id_extracted: "12345" } },
      { node: "classify", event_type: "completed", message: "route=tool reasoning='Order lookup required'", latency_ms: 295, metadata: { confidence: 0.96, required_tool: "order_lookup" } },
      { node: "tool", event_type: "executed", message: "SUCCESS: order_id=12345 status=shipped eta=2024-12-25", latency_ms: 450, metadata: { carrier: "FedEx", tracking: "FX-992810" } },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=success (valid carrier payload)", latency_ms: 120, metadata: { score: 1.0, retry_needed: false } },
      { node: "answer", event_type: "completed", message: "answer_length=118 chars synthesized", latency_ms: 235, metadata: { model: "gemini-flash" } },
      { node: "finalize", event_type: "completed", message: "workflow finished, checkpoint saved", latency_ms: 32, metadata: { checkpoint_id: "chk_093b", status: "success" } }
    ],
    final_answer: "Order #12345 is currently shipped and expected to arrive by December 25, 2024. Tracking status: In Transit (ETA confirmed)."
  },

  missing_info: {
    id: "S03_missing_info",
    route: "missing_info",
    route_label: "MISSING INFO",
    thread_id: "thread-S03_missing_info",
    query: "Fix it please",
    nodes_visited: 4,
    latency_ms: 623,
    retry_count: 0,
    interrupt_count: 0,
    node_sequence: ["intake", "classify", "clarify", "finalize"],
    events: [
      { node: "intake", event_type: "completed", message: "query normalized: 'Fix it please'", latency_ms: 110, metadata: { token_count: 3 } },
      { node: "classify", event_type: "completed", message: "route=missing_info reasoning='Vague query lacks context'", latency_ms: 270, metadata: { missing_slots: ["target_system", "error_description"] } },
      { node: "clarify", event_type: "completed", message: "clarification_requested: generated targeted question", latency_ms: 210, metadata: { prompt_variant: "polite_investigation" } },
      { node: "finalize", event_type: "completed", message: "workflow finished (awaiting user follow-up)", latency_ms: 33, metadata: { checkpoint_id: "chk_094c", status: "clarification_pending" } }
    ],
    pending_question: "I'd like to help! Could you clarify what specifically needs to be fixed? What system, account, or feature are you referring to?"
  },

  risky: {
    id: "S04_risky",
    route: "risky",
    route_label: "RISKY (HITL APPROVAL)",
    thread_id: "thread-S04_risky",
    query: "Refund customer and email",
    nodes_visited: 8,
    latency_ms: 1891,
    retry_count: 0,
    interrupt_count: 1,
    node_sequence_pre_approval: ["intake", "classify", "risky_action", "approval"],
    node_sequence_post_approval: ["tool", "evaluate", "answer", "finalize"],
    events_pre_approval: [
      { node: "intake", event_type: "completed", message: "query normalized: 'Refund customer and email'", latency_ms: 125, metadata: { category: "billing" } },
      { node: "classify", event_type: "completed", message: "route=risky risk_level=high (financial side-effect)", latency_ms: 310, metadata: { risk_score: 0.89, requires_hitl: true } },
      { node: "risky_action", event_type: "prepared", message: "action_staged: Refund $149.00 & notify customer", latency_ms: 180, metadata: { amount: 149.00, currency: "USD", action: "refund_and_email" } },
      { node: "approval", event_type: "interrupted", message: "PAUSED: Checkpoint waiting for human sign-off", latency_ms: 0, metadata: { gate: "HITL_FINANCIAL", timeout_sec: 300 } }
    ],
    events_post_approval: [
      { node: "approval", event_type: "completed", message: "APPROVED by human reviewer (mock-reviewer)", latency_ms: 540, metadata: { reviewer: "admin@corp.io", decision: "approve" } },
      { node: "tool", event_type: "executed", message: "SUCCESS: Refund $149.00 settled, email dispatched", latency_ms: 390, metadata: { transaction_id: "tx_992144", email_status: "queued" } },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=success (ledger reconciled)", latency_ms: 110, metadata: { verified: true } },
      { node: "answer", event_type: "completed", message: "answer_length=142 chars synthesized", latency_ms: 210, metadata: { model: "gemini-flash" } },
      { node: "finalize", event_type: "completed", message: "workflow finished, checkpoint committed", latency_ms: 26, metadata: { checkpoint_id: "chk_095d", status: "success" } }
    ],
    proposed_action: "PROPOSED ACTION: Refund customer $149.00 USD and send confirmation receipt. This has financial and external communication side effects.",
    final_answer: "The refund of $149.00 has been processed successfully, and a confirmation receipt has been emailed to the customer. (Approved by Human Reviewer)."
  },

  error: {
    id: "S05_error",
    route: "error",
    route_label: "ERROR (RETRY LOOP)",
    thread_id: "thread-S05_error_retry",
    query: "System timeout error",
    nodes_visited: 9,
    latency_ms: 3124,
    retry_count: 2,
    interrupt_count: 0,
    node_sequence: ["intake", "classify", "retry", "tool", "evaluate", "retry", "tool", "evaluate", "answer", "finalize"],
    events: [
      { node: "intake", event_type: "completed", message: "query normalized: 'System timeout error'", latency_ms: 120, metadata: { type: "system_health" } },
      { node: "classify", event_type: "completed", message: "route=error reasoning='Detected transient timeout event'", latency_ms: 300, metadata: { confidence: 0.94 } },
      { node: "retry", event_type: "incremented", message: "attempt=1 backoff=200ms staged", latency_ms: 150, metadata: { attempt: 1, max: 3 } },
      { node: "tool", event_type: "executed", message: "ERROR: Downstream service timeout on attempt 1 (504)", latency_ms: 950, metadata: { error_code: 504 } },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=needs_retry (transient failure)", latency_ms: 110, metadata: { recoverable: true } },
      { node: "retry", event_type: "incremented", message: "attempt=2 backoff=400ms staged", latency_ms: 210, metadata: { attempt: 2, max: 3 } },
      { node: "tool", event_type: "executed", message: "SUCCESS: Downstream recovered on attempt 2 (200 OK)", latency_ms: 820, metadata: { status_code: 200 } },
      { node: "evaluate", event_type: "completed", message: "evaluation_result=success after self-healing", latency_ms: 130, metadata: { recoverable: true } },
      { node: "answer", event_type: "completed", message: "answer_length=152 chars synthesized", latency_ms: 300, metadata: { model: "gemini-flash" } },
      { node: "finalize", event_type: "completed", message: "workflow finished, retry log persisted", latency_ms: 34, metadata: { checkpoint_id: "chk_096e", status: "recovered" } }
    ],
    final_answer: "The transient timeout issue has been resolved after 2 automated retry attempts with exponential backoff. All system health metrics have stabilized."
  }
};

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
      const scenarioKey = btn.getAttribute("data-scenario");
      if (MOCK_SCENARIOS[scenarioKey]) {
        executeScenario(MOCK_SCENARIOS[scenarioKey]);
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
// 6. Custom Query Matching & Heuristics
// -----------------------------------------------------------------------------
function handleCustomQuery(query) {
  dom.chatInput.value = "";
  const lower = query.toLowerCase();

  let matchedScenarioKey = "simple";
  if (lower.includes("refund") || lower.includes("delete") || lower.includes("destroy") || lower.includes("credit card") || lower.includes("money") || lower.includes("wire")) {
    matchedScenarioKey = "risky";
  } else if (lower.includes("order") || lower.includes("track") || lower.includes("status") || lower.includes("shipping") || lower.includes("#") || lower.includes("item")) {
    matchedScenarioKey = "tool";
  } else if (lower.includes("error") || lower.includes("timeout") || lower.includes("500") || lower.includes("fail") || lower.includes("retry") || lower.includes("crash")) {
    matchedScenarioKey = "error";
  } else if (lower.length < 15 || lower.includes("fix") || lower.includes("help") || lower.includes("broken") || lower.includes("what")) {
    matchedScenarioKey = "missing_info";
  }

  // Clone scenario and inject custom query
  const scenario = JSON.parse(JSON.stringify(MOCK_SCENARIOS[matchedScenarioKey]));
  scenario.query = query;
  executeScenario(scenario);
}

// -----------------------------------------------------------------------------
// 7. Scenario Execution & Workflow Orchestration
// -----------------------------------------------------------------------------
async function executeScenario(scenario) {
  state.isBusy = true;
  state.activeScenario = scenario;
  state.activeRoute = scenario.route;
  state.threadId = scenario.thread_id;

  // Update Header
  dom.threadIdText.textContent = scenario.thread_id;
  setSystemStatus("active", "Executing Graph...");
  setSendDisabled(true);

  // Append User Bubble
  appendUserMessage(scenario.query);

  // Reset Graph Trace View
  resetGraphTraceVisuals();

  // Handle Scenario (Risky HITL vs Automatic Stream)
  if (scenario.route === "risky") {
    await executeRiskyScenario(scenario);
  } else {
    await executeStandardScenario(scenario);
  }
}

/**
 * Standard Scenario Workflow (Simple, Tool, Missing Info, Error)
 */
async function executeStandardScenario(scenario) {
  // Update Active Route Pill
  updateRouteBadge(scenario.route, scenario.route_label);

  // Sequentially animate the node sequence
  const sequence = scenario.node_sequence;
  for (let i = 0; i < sequence.length; i++) {
    const nodeId = sequence[i];
    const event = scenario.events.find(e => e.node === nodeId);

    setNodeState(nodeId, "active");
    await sleep(getStepDelay(350));

    // If we just passed classify, display the route branch badge in the trace
    if (nodeId === "classify") {
      insertBranchBadge(scenario.route);
    }

    if (event) {
      recordEvent(event, scenario.thread_id);
    }

    setNodeState(nodeId, "completed");
  }

  // Mark all unvisited nodes as skipped
  markUnvisitedNodesSkipped(sequence);

  // Animate final telemetry metrics
  animateMetrics({
    nodes_visited: scenario.nodes_visited,
    latency_ms: scenario.latency_ms,
    retry_count: scenario.retry_count,
    interrupt_count: scenario.interrupt_count
  });

  // Render response in chat
  if (scenario.route === "missing_info") {
    appendClarificationMessage(scenario.pending_question, scenario.route);
  } else if (scenario.route === "error") {
    appendErrorMessage(scenario.final_answer, scenario.retry_count, scenario.route);
  } else {
    appendAgentMessage(scenario.final_answer, scenario.route);
  }

  setSystemStatus("idle", "Workflow Finished");
  setSendDisabled(false);
  state.isBusy = false;
}

/**
 * Risky Scenario Workflow (Human-in-the-Loop Approval Gate)
 */
async function executeRiskyScenario(scenario) {
  updateRouteBadge(scenario.route, scenario.route_label);

  // 1. Pre-Approval Execution (intake -> classify -> risky_action -> approval)
  const preSeq = scenario.node_sequence_pre_approval;
  for (let i = 0; i < preSeq.length; i++) {
    const nodeId = preSeq[i];
    const event = scenario.events_pre_approval.find(e => e.node === nodeId);

    if (nodeId === "approval") {
      setNodeState(nodeId, "risky-active");
    } else {
      setNodeState(nodeId, "active");
    }

    await sleep(getStepDelay(380));

    if (nodeId === "classify") {
      insertBranchBadge("risky");
    }

    if (event) {
      recordEvent(event, scenario.thread_id);
    }

    if (nodeId !== "approval") {
      setNodeState(nodeId, "completed");
    }
  }

  // 2. Pause and Render Approval Gate Card in Chat
  setSystemStatus("awaiting", "Awaiting HITL Approval");
  animateMetrics({
    nodes_visited: 4,
    latency_ms: 615,
    retry_count: 0,
    interrupt_count: 1
  });

  const approvalPromise = new Promise((resolve) => {
    appendApprovalGateCard(scenario.proposed_action, (decision) => {
      resolve(decision);
    });
  });

  const userDecision = await approvalPromise;

  // 3. Post-Approval Execution
  if (userDecision === "approve") {
    setSystemStatus("active", "Resuming Graph Execution...");
    setNodeState("approval", "completed");

    const postSeq = scenario.node_sequence_post_approval;
    for (let i = 0; i < postSeq.length; i++) {
      const nodeId = postSeq[i];
      const event = scenario.events_post_approval.find(e => e.node === nodeId);

      setNodeState(nodeId, "active");
      await sleep(getStepDelay(350));

      if (event) {
        recordEvent(event, scenario.thread_id);
      }

      setNodeState(nodeId, "completed");
    }

    // Mark skipped nodes
    const allVisited = [...preSeq, ...postSeq];
    markUnvisitedNodesSkipped(allVisited);

    // Final metrics
    animateMetrics({
      nodes_visited: scenario.nodes_visited,
      latency_ms: scenario.latency_ms,
      retry_count: scenario.retry_count,
      interrupt_count: scenario.interrupt_count
    });

    appendAgentMessage(scenario.final_answer, scenario.route);
    setSystemStatus("idle", "Action Executed & Approved");
  } else {
    // Rejected flow
    setNodeState("approval", "completed");
    setNodeState("dead_letter", "active");
    await sleep(getStepDelay(300));
    setNodeState("dead_letter", "completed");
    setNodeState("finalize", "completed");
    markUnvisitedNodesSkipped(["intake", "classify", "risky_action", "approval", "dead_letter", "finalize"]);

    recordEvent({
      node: "approval",
      event_type: "rejected",
      message: "REJECTED by human operator. Action aborted.",
      latency_ms: 0,
      metadata: { reviewer: "operator", decision: "rejected" }
    }, scenario.thread_id);

    appendAgentMessage("The staged risky action was rejected by the operator. The request has been safely halted and no changes were made.", "risky");
    setSystemStatus("idle", "Halted (Rejected)");
  }

  setSendDisabled(false);
  state.isBusy = false;
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
