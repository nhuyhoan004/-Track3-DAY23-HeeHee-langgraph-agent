"""Report generation helper."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .metrics import MetricsReport


def render_report(metrics: MetricsReport) -> str:
    """Render a complete lab report from metrics data in Vietnamese."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # --- Summary table ---
    summary = f"""# Báo Cáo Thực Hành Lab 08 — Điều Phối Agentic Với LangGraph

## 1. Thông Tin Nhóm & Phân Chia Công Việc

- **Tên nhóm**: HeeHee
- **Repository**: [nhuyhoan004/phase2-k3-4-track3-day8-HeeHee-langgraph-agent](https://github.com/nhuyhoan004/phase2-k3-4-track3-day8-HeeHee-langgraph-agent.git)
- **Commit hash**: `be73501`
- **Ngày hoàn thành**: {now}

### Bảng Phân Chia Công Việc (Đóng Góp Đồng Đều: 33.33% / Thành Viên)

| STT | Họ và Tên | Mã Số Sinh Viên | Tỷ Lệ Đóng Góp | Nhiệm Vụ Đảm Nhận Chi Tiết |
|:---:|---|:---:|:---:|---|
| 1 | **Nguyễn Duy Hưng** | 2A202601702 | **33.33%** | - Thiết kế và xây dựng cấu trúc đồ thị `StateGraph` (`graph.py`).<br>- Hiện thực các hàm định tuyến có điều kiện (`routing.py`): `route_intent`, `route_after_evaluate`, `route_after_retry`, `route_after_approval`.<br>- Xây dựng cơ chế Human-In-The-Loop (HITL) Interrupt và luồng phê duyệt hành động nhạy cảm (`approval_node`, `risky_action_node`).<br>- Thiết kế và kiểm thử kịch bản hành động rủi ro (`S04_risky`, `S06_delete`). |
| 2 | **Ngô Huy Hoàn** | 2A202601925 | **33.33%** | - Thiết kế Lược đồ Trạng thái `AgentState` (`state.py`) và cấu hình Reducers (append-only vs overwrite channels).<br>- Hiện thực hệ thống lưu trữ Checkpointer với SQLite WAL mode (`persistence.py`).<br>- Xây dựng cơ chế phục hồi trạng thái crash-resume và tính năng Time Travel Replay (`scripts/time_travel_demo.py`).<br>- Kiểm thử và tối ưu hóa luồng xử lý lỗi, vòng lặp retry có chặn giới hạn và hàng đợi Dead Letter (`S05_error`, `S07_dead_letter`). |
| 3 | **Nguyễn Tuấn Đức** | 2A202601380 | **33.33%** | - Hiện thực các node chức năng cốt lõi (`nodes.py`): `intake_node`, `classify_node` (sử dụng LLM Structured Output), `lookup_node` (Tool simulation), `evaluate_node`, `answer_node`, `finalize_node`.<br>- Xây dựng giao diện dòng lệnh CLI, thu thập và đo lường metrics kiểm thử (`cli.py`, `metrics.py`, `report.py`).<br>- Tự động sinh biểu đồ đồ thị kiến trúc Mermaid / SVG (`scripts/generate_diagram.py`), thực thi toàn bộ test suite và tổng hợp báo cáo. |

---

## 2. Kiến Trúc Hệ Thống (Architecture)

Hệ thống xây dựng trên nền tảng **LangGraph StateGraph** phục vụ bài toán phân luồng và xử lý vé hỗ trợ khách hàng tự động với 11 nodes chức năng:

**Luồng chính**: START → `intake` → `classify` → [conditional route] → ... → `finalize` → END

**Các quyết định thiết kế quan trọng**:
- `classify_node`: Sử dụng mô hình LLM (`gpt-4o-mini`) kết hợp `.with_structured_output()` để phân loại ý định thành 5 route (`simple`, `tool`, `missing_info`, `risky`, `error`) — tuyệt đối không dùng keyword heuristics thô sơ.
- `evaluate_node`: Đóng vai trò cổng kiểm tra (gate) chất lượng và tính hợp lệ của kết quả tool.
- `finalize_node`: Điểm hội tụ bắt buộc của tất cả các nhánh trước khi kết thúc (END) nhằm phục vụ kiểm toán và chuẩn hóa output.
- Bounded retry: Giới hạn số lần thử lại thông qua `max_attempts` nhằm chống vòng lặp vô hạn.

## 3. Lược Đồ Trạng Thái (State Schema)

| Tên Trường (Field) | Kiểu Reducer | Mục Đích Thiết Kế & Sử Dụng |
|---|:---:|---|
| `messages` | `add` (append) | Lưu trữ toàn bộ lịch sử trao đổi hội thoại và sự kiện để kiểm toán. |
| `tool_results` | `add` (append) | Bảo toàn tất cả kết quả gọi công cụ qua các lần thử (retries). |
| `errors` | `add` (append) | Ghi nhận chi tiết tất cả các thông điệp lỗi phát sinh trong quá trình thực thi. |
| `events` | `add` (append) | Lưu vết audit trail chi tiết về thứ tự các node đã thực thi. |
| `route` | `overwrite` | Chỉ lưu trữ quyết định định tuyến của nhánh hiện tại. |
| `attempt` | `overwrite` | Theo dõi số lần thử lại hiện tại trong vòng lặp retry. |
| `should_retry` | `overwrite` | Cờ điều khiển mô phỏng lỗi công cụ phục vụ kiểm thử kịch bản giả lập. |
| `tool_status` | `overwrite` | Cờ trạng thái cấu trúc (`ok`/`error`) — cổng evaluate đọc trực tiếp cờ này. |
| `evaluation_result` | `overwrite` | Quyết định đánh giá mới nhất của cổng kiểm tra (`success`/`needs_retry`). |
| `pending_question` | `overwrite` | Nội dung câu hỏi làm rõ mới nhất gửi tới người dùng. |
| `proposed_action` | `overwrite` | Mô tả chi tiết hành động nhạy cảm cần con người phê duyệt. |
| `approval` | `overwrite` | Quyết định phê duyệt mới nhất từ phía người dùng/quản trị viên. |

## 4. Kết Quả Thực Nghiệm Kịch Bản (Scenario Results)

"""

    # Per-scenario table
    summary += (
        "| Mã Kịch Bản (Scenario) | Luồng Kì Vọng (Expected) | Luồng Thực Tế (Actual) | Trạng Thái | Số Node | Số Lần Retry | Số Lần Interrupt | Độ Trễ (Latency) |\n"
    )
    summary += "|---|---|---|:---:|---:|---:|---:|---:|\n"
    for m in metrics.scenario_metrics:
        success_icon = "✅" if m.success else "❌"
        summary += (
            f"| {m.scenario_id} | {m.expected_route} | {m.actual_route or 'N/A'} "
            f"| {success_icon} | {m.nodes_visited} | {m.retry_count} | {m.interrupt_count} "
            f"| {m.latency_ms} ms |\n"
        )

    summary += f"""
### Tổng Hợp Chỉ Số Hiệu Năng:
- **Tổng số kịch bản**: {metrics.total_scenarios}
- **Tỷ lệ thành công**: {metrics.success_rate:.1%}
- **Số node trung bình đi qua**: {metrics.avg_nodes_visited:.1f}
- **Tổng số lần retry**: {metrics.total_retries}
- **Tổng số lần ngắt HITL**: {metrics.total_interrupts}
- **Xác thực phục hồi Checkpoint**: {"Thành công (yes)" if metrics.resume_success else "Thất bại (no)"}

## 5. Phân Tích Các Chế Độ Lỗi (Failure Analysis)

### Chế Độ Lỗi 1: Cạn Kiệt Số Lần Thử Lại (Retry Exhaustion) → Dead Letter
Khi nhánh `error` được kích hoạt và công cụ gặp lỗi lặp đi lặp lại, hệ thống tăng biến đếm `attempt` cho đến khi `attempt >= max_attempts`. Tại điểm này, `route_after_retry` trả về nhánh "dead_letter" thay vì "tool", giúp bẻ gãy vòng lặp vô hạn. Kịch bản S07 minh chứng cơ chế này với `max_attempts=1`.

- **Nguyên nhân gốc rễ**: Lỗi gián đoạn tạm thời của công cụ/API bên thứ ba (timeout, service unavailable).
- **Cơ chế xử lý**: Node Dead Letter chuyển tiếp toàn bộ ngữ cảnh và lịch sử lỗi cho đội ngũ hỗ trợ con người xử lý.

### Chế Độ Lỗi 2: Thực Thi Hành Động Rủi Ro Không Qua Phê Duyệt (Risky Action Without Approval)
Nếu không có bước phê duyệt Human-In-The-Loop (HITL), các hành động nguy hiểm (như hoàn tiền, xóa dữ liệu) sẽ bị thực thi trực tiếp ngoài ý muốn. Node `risky_action_node` chuẩn bị nội dung mô tả, sau đó `approval_node` chặn luồng thực thi. Nếu cấu hình `LANGGRAPH_INTERRUPT=true`, hệ thống sẽ yêu cầu người dùng thật duyệt; ngược lại, hệ thống sử dụng mock approval phục vụ kiểm thử.

- **Nguyên nhân gốc rễ**: Các hành động có tác dụng phụ không thể đảo ngược cần sự giám sát của con người.
- **Cơ chế xử lý**: Cổng phê duyệt an toàn với khả năng cấu hình linh hoạt chế độ mock / real thông qua biến môi trường.

## 6. Bằng Chứng Về Tính Bền Vững & Khả Năng Phục Hồi (Persistence / Recovery Evidence)

- **Cơ chế Checkpointer**: SQLite (`outputs/checkpoints.db`) cấu hình ở chế độ WAL mode.
- **Quản lý Thread ID**: Mỗi lượt chạy kịch bản sử dụng một `thread_id` **duy nhất** (`thread-<scenario_id>-<run_uuid>`).
- **Lưu trữ trạng thái**: Trạng thái được tự động checkpoint sau khi mỗi node hoàn thành thực thi.
- **Xác thực Phục Hồi (`resume_success = {metrics.resume_success}`)**: Được kiểm tra bởi `cli._check_resume()`. Sau khi chạy toàn bộ kịch bản, hệ thống truy xuất lại thread cuối cùng qua `get_state_history()` và đọc lại trạng thái bền vững với `get_state()`. Giá trị đạt `true` khi lịch sử có nhiều hơn 1 checkpoint và trạng thái khôi phục giữ nguyên vẹn câu trả lời cuối cùng.
- Minh họa tính năng Time Travel độc lập tại `scripts/time_travel_demo.py`.

> **Tại sao `thread_id` bắt buộc phải là duy nhất trên mỗi lượt chạy**: Các kênh `events`, `errors`, `messages` và `tool_results` sử dụng reducer cộng dồn `add`. Việc tái sử dụng `thread_id` cố định với SQLite checkpointer bền vững sẽ nạp lại toàn bộ giá trị của lần chạy trước đó, khiến các thông số thống kê trong báo cáo bị cộng dồn nhân đôi/nhân ba.

## 7. Các Công Việc Mở Rộng (Extension Work)

1. **Lưu trữ trạng thái SQLite**: Hiện thực `SqliteSaver` với WAL mode trong `persistence.py`.
2. **Biểu đồ trực quan Mermaid**: Sinh biểu đồ tự động thông qua `graph.get_graph().draw_mermaid()` trong `scripts/generate_diagram.py`.
3. **Time Travel Replay**: Script `scripts/time_travel_demo.py` chứng minh khả năng duyệt lại toàn bộ checkpoint qua `get_state_history()`.
4. **Cơ chế HITL Interrupt**: Node `approval_node` hỗ trợ ngắt luồng `interrupt()` khi `LANGGRAPH_INTERRUPT=true`.

## 8. Kế Hoạch Cải Tiến (Improvement Plan)

Nếu có thêm thời gian phát triển đưa lên Production:
1. **Tích hợp Tool API thực tế**: Thay thế mock tool bằng các API gọi đến hệ thống quản lý đơn hàng thật.
2. **Phản hồi dạng dòng (Streaming responses)**: Sử dụng `graph.stream()` để stream token câu trả lời thời gian thực trong `answer_node`.
3. **Đánh giá chất lượng bằng LLM-as-a-judge trong evaluate_node**: Sử dụng LLM độc lập để chấm điểm độ chuẩn xác của kết quả từ tool.
4. **Retry với Exponential Backoff**: Bổ sung độ trễ luỹ thừa giữa các lần thử lại nhằm tránh chạm rate limits.
5. **Chuyển sang Postgres Checkpointer**: Hỗ trợ lưu trữ bền vững cấp doanh nghiệp với khả năng truy cập đồng thời cao.
"""
    return summary


def write_report(metrics: MetricsReport, output_path: str | Path) -> None:
    """Write the rendered report to a file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(metrics), encoding="utf-8")
