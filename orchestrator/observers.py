"""Pipeline observer for recording per-stage and end-to-end latency metrics."""

import time
import logging

from pipecat.frames.frames import (
    AudioRawFrame,
    Frame,
    TextFrame,
    TranscriptionFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed

from metrics import stage_duration, e2e_latency

logger = logging.getLogger(__name__)


class MetricsObserver(BaseObserver):
    """Pipeline observer that records per-stage and end-to-end latency.

    Hooks into on_push_frame events to timestamp frame transitions
    between processors and compute stage durations.
    """

    def __init__(self):
        super().__init__()
        self._turn_start_time: float | None = None
        self._stage_start_times: dict[str, float] = {}

    async def on_push_frame(self, data: FramePushed):
        """Called by the pipeline when a frame is pushed between processors."""
        now = time.perf_counter()
        frame = data.frame
        src_name = data.source.name.lower() if data.source else ""
        dst_name = data.destination.name.lower() if data.destination else ""

        # Track VAD → STT transition (start of STT stage)
        if isinstance(frame, AudioRawFrame) and "stt" in dst_name:
            self._stage_start_times["stt"] = now
            # Mark start of E2E measurement (first audio dispatched to STT)
            if self._turn_start_time is None:
                self._turn_start_time = now

        # Track STT → LLM transition (end of STT stage, start of LLM stage)
        elif isinstance(frame, TranscriptionFrame):
            if "stt" in self._stage_start_times:
                elapsed = now - self._stage_start_times.pop("stt")
                stage_duration.labels(stage="stt", status="ok").observe(elapsed)
            self._stage_start_times["llm"] = now

        # Track LLM → TTS transition (end of LLM stage, start of TTS stage)
        elif isinstance(frame, TextFrame) and "tts" in dst_name:
            if "llm" in self._stage_start_times:
                elapsed = now - self._stage_start_times.pop("llm")
                stage_duration.labels(stage="llm", status="ok").observe(elapsed)
            if "tts" not in self._stage_start_times:
                self._stage_start_times["tts"] = now

        # Track TTS → Transport output (end of TTS stage, E2E complete)
        elif isinstance(frame, AudioRawFrame) and "output" in dst_name:
            if "tts" in self._stage_start_times:
                elapsed = now - self._stage_start_times.pop("tts")
                stage_duration.labels(stage="tts", status="ok").observe(elapsed)
            if self._turn_start_time is not None:
                e2e = now - self._turn_start_time
                e2e_latency.observe(e2e)
                self._turn_start_time = None
