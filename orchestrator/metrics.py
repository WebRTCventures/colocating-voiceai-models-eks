"""Prometheus instrumentation and HTTP health/metrics server."""

from prometheus_client import Histogram, generate_latest, CONTENT_TYPE_LATEST
from aiohttp import web

# Histogram buckets tuned for voice latency
VOICE_LATENCY_BUCKETS = (0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0)

stage_duration = Histogram(
    "voice_pipeline_stage_duration_seconds",
    "Per-stage processing duration",
    labelnames=["stage", "status"],
    buckets=VOICE_LATENCY_BUCKETS,
)

e2e_latency = Histogram(
    "voice_pipeline_e2e_latency_seconds",
    "End-to-end latency from VAD trigger to first TTS audio byte",
    buckets=VOICE_LATENCY_BUCKETS,
)


async def handle_metrics(request: web.Request) -> web.Response:
    """Return Prometheus metrics in text exposition format."""
    return web.Response(
        body=generate_latest(),
        headers={"Content-Type": CONTENT_TYPE_LATEST},
    )


async def handle_health(request: web.Request) -> web.Response:
    """Return health check JSON response."""
    return web.json_response({"status": "ok"})


async def start_metrics_server(port: int) -> web.AppRunner:
    """Start aiohttp server exposing /metrics and /health."""
    app = web.Application()
    app.router.add_get("/metrics", handle_metrics)
    app.router.add_get("/health", handle_health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    return runner
