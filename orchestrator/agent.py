"""Pipecat Orchestrator Agent — main entry point.

Assembles the VAD → STT → LLM → TTS pipeline over LiveKit WebRTC transport,
starts the metrics/health server, and manages the agent lifecycle.
"""

import asyncio
import logging
import signal

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMContextFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport
from pipecat.turns.user_start import VADUserTurnStartStrategy
from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from config import load_config
from livekit_token import generate_token
from metrics import start_metrics_server
from observers import MetricsObserver

SYSTEM_PROMPT = (
    "You are a helpful voice assistant. Keep your responses concise "
    "and conversational. Respond naturally as if speaking to someone."
)


async def main():
    """Run the voice agent pipeline."""
    config = load_config()

    # Start metrics/health HTTP server
    metrics_runner = await start_metrics_server(config.metrics_port)

    # Configure LiveKit transport (audio only)
    transport = LiveKitTransport(
        url=config.livekit_url,
        token=generate_token(config),
        room_name="voice-agent-room",
        params=LiveKitParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )

    # Configure STT service (Speaches via OpenAI-compatible API)
    stt = OpenAISTTService(
        base_url=config.stt_base_url,
        api_key="sk-placeholder",
        model=config.stt_model,
    )

    # Configure LLM service (vLLM via OpenAI-compatible API)
    llm = OpenAILLMService(
        base_url=config.llm_base_url,
        api_key="sk-placeholder",
        model=config.llm_model,
    )

    # Configure TTS service (Speaches via OpenAI-compatible API)
    tts = OpenAITTSService(
        base_url=config.tts_base_url,
        api_key="sk-placeholder",
        model=config.tts_model,
    )

    # Build universal LLM context (provider-agnostic, Pipecat 1.0+)
    context = LLMContext(messages=[{"role": "system", "content": SYSTEM_PROMPT}])

    # Configure turn management with VAD and interruption handling
    vad_stop_secs = config.vad_silence_threshold_ms / 1000.0

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(stop_secs=vad_stop_secs)
            ),
            user_turn_strategies=UserTurnStrategies(
                start=[VADUserTurnStartStrategy()],
                stop=[
                    SpeechTimeoutUserTurnStopStrategy(
                        user_speech_timeout=vad_stop_secs
                    )
                ],
            ),
        ),
    )

    # Assemble pipeline
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    # Create pipeline task with metrics observer
    task = PipelineTask(pipeline, observers=[MetricsObserver(transport=transport)])

    # Set up the pipeline runner
    runner = PipelineRunner()

    # Graceful shutdown on SIGTERM/SIGINT (Kubernetes pod termination)
    loop = asyncio.get_event_loop()

    def handle_shutdown(sig, _frame):
        logging.info(f"Received {signal.Signals(sig).name}, shutting down...")
        loop.create_task(task.cancel())

    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    # Handle participant lifecycle events
    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport_obj, participant_id):
        logging.info(f"First participant joined: {participant_id}")
        await task.queue_frame(LLMContextFrame(context=context))

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport_obj, participant_id, reason):
        logging.info(f"Participant left: {participant_id} ({reason})")
        await task.cancel()

    # Run the pipeline — restart on participant disconnect so the agent
    # is always available for the next session without pod restarts.
    while True:
        await runner.run(task)
        logging.info("Session ended. Reconnecting to room for next participant...")

        # Rebuild transport, context, and pipeline for a fresh session
        transport = LiveKitTransport(
            url=config.livekit_url,
            token=generate_token(config),
            room_name="voice-agent-room",
            params=LiveKitParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
        )

        context = LLMContext(messages=[{"role": "system", "content": SYSTEM_PROMPT}])
        user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
            context,
            user_params=LLMUserAggregatorParams(
                vad_analyzer=SileroVADAnalyzer(
                    params=VADParams(stop_secs=vad_stop_secs)
                ),
                user_turn_strategies=UserTurnStrategies(
                    start=[VADUserTurnStartStrategy()],
                    stop=[
                        SpeechTimeoutUserTurnStopStrategy(
                            user_speech_timeout=vad_stop_secs
                        )
                    ],
                ),
            ),
        )

        pipeline = Pipeline(
            [
                transport.input(),
                stt,
                user_aggregator,
                llm,
                tts,
                transport.output(),
                assistant_aggregator,
            ]
        )
        task = PipelineTask(pipeline, observers=[MetricsObserver(transport=transport)])

        @transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(transport_obj, participant_id):
            logging.info(f"First participant joined: {participant_id}")
            await task.queue_frame(LLMContextFrame(context=context))

        @transport.event_handler("on_participant_left")
        async def on_participant_left(transport_obj, participant_id, reason):
            logging.info(f"Participant left: {participant_id} ({reason})")
            await task.cancel()

        await asyncio.sleep(1)  # Brief pause before reconnecting

    # Cleanup metrics server on exit (reached only via SIGTERM)
    await metrics_runner.cleanup()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
