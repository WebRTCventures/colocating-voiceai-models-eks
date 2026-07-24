# Implementation Plan: Pipecat Orchestrator Agent

## Overview

Implement a Python voice agent using Pipecat SDK that orchestrates a VAD → STT → LLM → TTS pipeline over LiveKit WebRTC transport. The agent runs as a CPU-only container, reads configuration from environment variables, exposes Prometheus metrics, and supports barge-in interruption. All source files are created in the `orchestrator/` directory at the project root.

## Tasks

- [ ] 1. Set up project structure and dependencies
  - [ ] 1.1 Create `orchestrator/` directory with `requirements.txt` and empty module files
    - Create `orchestrator/requirements.txt` with pinned dependencies: `pipecat-ai[livekit,silero,openai]>=1.0.0`, `livekit-api>=0.7.0`, `prometheus-client>=0.20.0`, `aiohttp>=3.9.0`
    - Create empty `orchestrator/config.py`, `orchestrator/metrics.py`, `orchestrator/observers.py`, `orchestrator/token.py`, `orchestrator/agent.py`
    - _Requirements: 9.2_

- [ ] 2. Implement configuration loading and validation
  - [ ] 2.1 Implement `orchestrator/config.py` with `Config` dataclass and `load_config()` function
    - Define frozen dataclass with fields: `livekit_url`, `livekit_api_key`, `livekit_api_secret`, `stt_base_url`, `tts_base_url`, `llm_base_url`, `stt_model`, `tts_model`, `llm_model`, `vad_silence_threshold_ms`, `metrics_port`
    - Implement `load_config()` that reads from `os.environ`, validates required variables (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `STT_BASE_URL`, `TTS_BASE_URL`, `LLM_BASE_URL`), validates ranged integers (`VAD_SILENCE_THRESHOLD_MS` 100–2000 default 200, `METRICS_PORT` 1–65535 default 8080), applies defaults for optional model vars (empty string)
    - On missing required vars or invalid ranges, call `sys.exit(1)` with error message naming each invalid/missing variable
    - _Requirements: 1.6, 2.2, 2.5, 3.6, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 2.2 Write property tests for config validation (Property 1: Required variable validation)
    - **Property 1: Required variable validation**
    - Use Hypothesis to generate subsets of required env vars that are missing/empty and verify `load_config()` raises `SystemExit` naming each missing var
    - **Validates: Requirements 1.6, 8.6**

  - [ ]* 2.3 Write property tests for config range validation (Property 2: Config range validation)
    - **Property 2: Config range validation**
    - Use Hypothesis to generate integers inside/outside [100, 2000] for `VAD_SILENCE_THRESHOLD_MS` and [1, 65535] for `METRICS_PORT`, verify acceptance or `SystemExit` accordingly
    - **Validates: Requirements 2.2, 8.4, 8.5, 8.7**

- [ ] 3. Implement metrics server and Prometheus instrumentation
  - [ ] 3.1 Implement `orchestrator/metrics.py` with histograms and aiohttp health/metrics server
    - Define `stage_duration` Histogram with labels `["stage", "status"]` and voice latency buckets `(0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0)`
    - Define `e2e_latency` Histogram with same buckets
    - Implement `start_metrics_server(port)` creating aiohttp app with `/metrics` and `/health` routes
    - `/health` returns JSON `{"status": "ok"}` with HTTP 200
    - `/metrics` returns `generate_latest()` with correct content type
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.3_

  - [ ]* 3.2 Write unit tests for metrics server
    - Test `/health` returns 200 with `{"status": "ok"}`
    - Test `/metrics` returns valid Prometheus text format with expected metric names
    - Test histogram buckets match specification
    - _Requirements: 7.3, 7.4_

- [ ] 4. Implement pipeline observer for latency measurement
  - [ ] 4.1 Implement `orchestrator/observers.py` with `MetricsObserver` class
    - Implement `MetricsObserver` with `on_push_frame` method that tracks frame transitions between processors
    - Record STT stage duration (AudioRawFrame → TranscriptionFrame transition)
    - Record LLM stage duration (TranscriptionFrame → TextFrame transition)
    - Record TTS stage duration (TextFrame → AudioRawFrame output transition)
    - Record E2E latency from VAD trigger (first audio to STT) to first TTS audio byte output
    - Use `time.perf_counter()` for high-resolution timing
    - _Requirements: 7.1, 7.2, 7.5_

  - [ ]* 4.2 Write property tests for stage duration measurement (Property 7: Stage duration measurement)
    - **Property 7: Stage duration measurement**
    - Use Hypothesis to generate mock frame sequences and verify that every stage execution records an observation with correct `stage` and `status` labels
    - **Validates: Requirements 7.1, 7.5**

- [ ] 5. Checkpoint - Verify config and metrics modules
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement LiveKit token generation
  - [ ] 6.1 Implement `orchestrator/token.py` with `generate_token()` function
    - Generate LiveKit JWT with identity `"voice-agent"`, name `"Voice Agent"`
    - Grant `room_join=True`, `room="voice-agent-room"`, `can_publish=True`, `can_subscribe=True`
    - Accept config object to read `livekit_api_key` and `livekit_api_secret`
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 7. Implement main agent pipeline assembly
  - [ ] 7.1 Implement `orchestrator/agent.py` with full pipeline wiring
    - Import and call `load_config()` at startup
    - Start metrics server via `start_metrics_server(config.metrics_port)`
    - Configure `LiveKitTransport` with token from `generate_token(config)`, `audio_in_enabled=True`, `audio_out_enabled=True`
    - Configure `OpenAISTTService` with `base_url=config.stt_base_url`, `api_key="sk-placeholder"`, `model=config.stt_model`
    - Configure `OpenAILLMService` with `base_url=config.llm_base_url`, `api_key="sk-placeholder"`, `model=config.llm_model`
    - Configure `OpenAITTSService` with `base_url=config.tts_base_url`, `api_key="sk-placeholder"`, `model=config.tts_model`
    - Build `LLMContext` with system prompt, create `LLMContextAggregatorPair` with `SileroVADAnalyzer` (stop_secs from config) and `UserTurnStrategies` with `VADUserTurnStartStrategy` and `SpeechTimeoutUserTurnStopStrategy`
    - Assemble pipeline: `[transport.input(), stt, user_aggregator, llm, tts, transport.output(), assistant_aggregator]`
    - Create `PipelineTask` with `MetricsObserver` in observers list
    - Register SIGTERM/SIGINT handlers that cancel the pipeline task
    - Register `on_first_participant_joined` and `on_participant_left` event handlers
    - Run pipeline via `PipelineRunner`
    - Cleanup metrics runner on exit
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 9.4, 9.7_

  - [ ]* 7.2 Write property tests for exponential backoff timing (Property 3: Exponential backoff timing)
    - **Property 3: Exponential backoff timing**
    - Use Hypothesis to generate retry attempt numbers in [1, 5] and verify delay is `2^(n-1)` seconds
    - **Validates: Requirements 1.4**

  - [ ]* 7.3 Write property tests for transcription filtering (Property 4: Transcription filtering)
    - **Property 4: Transcription filtering**
    - Use Hypothesis to generate strings with/without non-whitespace characters, verify forwarding/discarding behavior
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 7.4 Write property tests for sentence boundary segmentation (Property 5: Sentence boundary segmentation)
    - **Property 5: Sentence boundary segmentation**
    - Use Hypothesis to generate token streams, verify TTS dispatch occurs at sentence boundaries (`.`, `!`, `?` followed by space or EOS) and each segment is a complete sentence
    - **Validates: Requirements 4.3**

  - [ ]* 7.5 Write property tests for context window invariant (Property 6: Context window invariant)
    - **Property 6: Context window invariant**
    - Use Hypothesis to generate sequences of conversation turns, verify context never exceeds 20 messages and oldest pairs are dropped first while system prompt is preserved
    - **Validates: Requirements 4.4**

- [ ] 8. Checkpoint - Verify agent module and property tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Create Dockerfile and container configuration
  - [ ] 9.1 Create `orchestrator/Dockerfile`
    - Use `python:3.11-slim` base image
    - Create non-root user (`agent`) with `groupadd`/`useradd`
    - Copy `requirements.txt` and install dependencies with `pip install --no-cache-dir`
    - Copy all Python source files (`agent.py`, `config.py`, `metrics.py`, `token.py`, `observers.py`)
    - Switch to non-root user, expose port 8080
    - Set `STOPSIGNAL SIGTERM` and `ENTRYPOINT ["python", "agent.py"]`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using Hypothesis
- All source files reside in `orchestrator/` at the project root
- The agent uses Pipecat 1.0 patterns: `LLMContextAggregatorPair`, `UserTurnStrategies`, pipeline observers
- Services use `api_key="sk-placeholder"` since Speaches and vLLM don't require authentication

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "4.1"] },
    { "id": 3, "tasks": ["4.2", "6.1"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["9.1"] }
  ]
}
```
