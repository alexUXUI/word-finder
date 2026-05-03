#!/usr/bin/env python3
"""
MLflow trace proxy.

Accepts GenerationTrace JSON from the browser / Node code, replays it into
MLflow as native traces using the mlflow SDK. Required because:
- Browser CORS blocks direct POST to MLflow.
- MLflow's OTLP /v1/traces endpoint requires protobuf (not JSON).

Run alongside `mlflow server --port 5000`:
    cd tools/mlflow-proxy
    python3 server.py

Default ports:
    5000 — MLflow Tracking Server (`mlflow server`)
    5001 — this proxy (browser + Node clients POST here)

Configurable via env:
    MLFLOW_TRACKING_URI  — default http://localhost:5000
    MLFLOW_PROXY_PORT    — default 5001
    MLFLOW_PROXY_HOST    — default 127.0.0.1
"""
from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import mlflow
from mlflow.entities import SpanStatus, SpanStatusCode, SpanType


TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", "http://localhost:5000")
PROXY_HOST = os.environ.get("MLFLOW_PROXY_HOST", "127.0.0.1")
PROXY_PORT = int(os.environ.get("MLFLOW_PROXY_PORT", "5001"))

mlflow.set_tracking_uri(TRACKING_URI)


def _span_type(t: str) -> str:
    """Map our SpanType strings to mlflow's. Unknown → UNKNOWN."""
    name = (t or "").upper()
    if hasattr(SpanType, name):
        return getattr(SpanType, name)
    return SpanType.UNKNOWN


def _replay_trace(payload: dict[str, Any]) -> str:
    """Convert a GenerationTrace dict into MLflow spans and log them."""
    experiment_name = payload.get("experiment_name", "word-finder")
    mlflow.set_experiment(experiment_name)

    trace_meta = payload["trace"]
    spans = trace_meta["spans"]
    if not spans:
        # Nothing to do; just record an empty trace via a single AGENT span.
        with mlflow.start_span(
            name=trace_meta.get("goal_signature", "empty"),
            span_type=SpanType.AGENT,
        ):
            pass
        return "(empty)"

    # Spans are emitted in start order. Reconstruct the parent-child tree by
    # span_id and walk depth-first, opening / closing mlflow context managers
    # in the correct nesting.
    spans_by_id = {s["span_id"]: s for s in spans}
    children: dict[str | None, list[dict[str, Any]]] = {}
    for s in spans:
        children.setdefault(s.get("parent_span_id"), []).append(s)
    for kids in children.values():
        kids.sort(key=lambda s: s["start_ms"])

    def open_span(s: dict[str, Any]):
        attrs = dict(s.get("attributes") or {})
        if s.get("inputs") is not None:
            attrs["mlflow.span.inputs"] = json.dumps(s["inputs"])[:8000]
        if s.get("outputs") is not None:
            attrs["mlflow.span.outputs"] = json.dumps(s["outputs"])[:8000]
        return mlflow.start_span(
            name=s["name"],
            span_type=_span_type(s.get("type", "TOOL")),
            attributes=attrs,
        )

    def visit(span_dict: dict[str, Any]):
        with open_span(span_dict) as span:
            err = span_dict.get("error")
            if err:
                span.set_status(SpanStatus(SpanStatusCode.ERROR, err.get("message", "")))
            for child in children.get(span_dict["span_id"], []):
                visit(child)

    roots = children.get(None, [])
    if not roots:
        # Defensive: if no top-level span, treat first by start_ms as root.
        roots = [min(spans, key=lambda s: s["start_ms"])]

    # Wrap everything under a single AGENT root so MLflow treats it as one trace.
    with mlflow.start_span(
        name=trace_meta.get("goal_signature", "generation"),
        span_type=SpanType.AGENT,
        attributes={
            "word_finder.generation_id": trace_meta.get("generation_id", ""),
            "word_finder.final_score": trace_meta["outcome"]["final_score"],
            "word_finder.candidates_evaluated": trace_meta["outcome"][
                "candidates_evaluated"
            ],
            "word_finder.selected_strategy": trace_meta["outcome"][
                "selected_strategy"
            ],
            "word_finder.elapsed_ms": trace_meta["outcome"]["elapsed_ms"],
        },
    ) as root:
        for r in roots:
            visit(r)
        return root.trace_id


def _cors_headers(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers", "Content-Type, x-mlflow-experiment-id"
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # quiet
        sys.stderr.write(
            "[mlflow-proxy] %s - %s\n" % (self.address_string(), fmt % args)
        )

    def do_OPTIONS(self) -> None:  # noqa: N802 — http.server convention
        self.send_response(204)
        _cors_headers(self)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            body = json.dumps({"ok": True, "tracking_uri": TRACKING_URI}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            _cors_headers(self)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        _cors_headers(self)
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/traces":
            self.send_response(404)
            _cors_headers(self)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            self._reply(400, {"error": f"invalid json: {exc}"})
            return
        try:
            trace_id = _replay_trace(payload)
        except Exception as exc:  # noqa: BLE001
            self._reply(500, {"error": f"replay failed: {exc}"})
            return
        self._reply(200, {"ok": True, "trace_id": trace_id})

    def _reply(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        _cors_headers(self)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    server = ThreadingHTTPServer((PROXY_HOST, PROXY_PORT), Handler)
    sys.stderr.write(
        f"[mlflow-proxy] listening on http://{PROXY_HOST}:{PROXY_PORT}\n"
        f"[mlflow-proxy] forwarding to MLflow at {TRACKING_URI}\n"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[mlflow-proxy] shutting down\n")
        server.shutdown()


if __name__ == "__main__":
    main()
