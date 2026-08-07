"""LiveKit Agents Voice AI — main entry point.

Connects STT (Speaches) → LLM (vLLM) → TTS (Speaches) in a voice pipeline
using LiveKit Agents framework with OpenAI-compatible endpoints.
"""

import json
import logging
import os

from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    AgentServer,
    cli,
)
from livekit.plugins import openai, silero

logger = logging.getLogger("voice-agent")
logger.setLevel(logging.INFO)

# Service endpoints (injected via ConfigMap environment variables)
STT_BASE_URL = os.environ.get("STT_BASE_URL", "http://localhost:8001/v1")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8000/v1")
TTS_BASE_URL = os.environ.get("TTS_BASE_URL", "http://localhost:8001/v1")
STT_MODEL = os.environ.get("STT_MODEL", "deepdml/faster-whisper-large-v3-turbo-ct2")
LLM_MODEL = os.environ.get("LLM_MODEL", "hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4")
TTS_MODEL = os.environ.get("TTS_MODEL", "speaches-ai/Kokoro-82M-v1.0-ONNX")

SYSTEM_PROMPT = (
    "You are a helpful voice assistant. Keep your responses concise "
    "and conversational. Respond naturally as if speaking to someone."
)


class VoiceAssistant(Agent):
    """Voice assistant agent that greets the user on entry."""

    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)

    async def on_enter(self):
        self.session.generate_reply(
            instructions="Greet the user briefly and ask how you can help."
        )


server = AgentServer()


def prewarm(proc: JobProcess):
    """Preload VAD model once per process for faster session starts."""
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    """Handle an incoming voice session."""
    ctx.log_context_fields = {"room": ctx.room.name}

    session = AgentSession(
        stt=openai.STT(
            model=STT_MODEL,
            base_url=STT_BASE_URL,
            api_key="sk-placeholder",
        ),
        llm=openai.LLM(
            model=LLM_MODEL,
            base_url=LLM_BASE_URL,
            api_key="sk-placeholder",
        ),
        # Speaches sends raw PCM in SSE streaming mode regardless of response_format.
        # Using response_format="pcm" tells the SDK to expect raw PCM, matching what
        # Speaches actually delivers.
        tts=openai.TTS(
            model=TTS_MODEL,
            voice="af_heart",
            base_url=TTS_BASE_URL,
            api_key="not-needed",
            response_format="pcm",
        ),
        vad=ctx.proc.userdata["vad"],
    )

    # Publish per-stage metrics to the room for browser display
    @session.on("metrics_collected")
    def on_metrics(ev):
        metrics = ev.metrics
        from livekit.agents.metrics.base import STTMetrics, LLMMetrics, TTSMetrics

        data: dict = {"type": "latency"}
        if isinstance(metrics, STTMetrics):
            data["stt_ms"] = round(metrics.duration * 1000)
        elif isinstance(metrics, LLMMetrics):
            data["llm_ms"] = round((metrics.ttft or 0) * 1000)
        elif isinstance(metrics, TTSMetrics):
            data["tts_ms"] = round((metrics.ttfb or 0) * 1000)
        else:
            return

        try:
            import asyncio
            asyncio.create_task(_publish_data(ctx, json.dumps(data)))
        except Exception:
            pass

    await session.start(
        agent=VoiceAssistant(),
        room=ctx.room,
    )

    await ctx.connect()


async def _publish_data(ctx: JobContext, message: str):
    """Publish a data message to the room."""
    try:
        local = ctx.room.local_participant
        if local:
            await local.publish_data(message.encode(), reliable=True)
    except Exception as e:
        logger.debug(f"Failed to publish data: {e}")


if __name__ == "__main__":
    cli.run_app(server)
