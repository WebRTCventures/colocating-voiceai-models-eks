# Requirements Document

## Introduction

This spec defines the Pipecat Orchestrator Agent — a Python-based voice agent that coordinates the real-time audio pipeline (VAD → STT → LLM → TTS) for the colocated voice AI system on EKS. The agent connects to a LiveKit room for WebRTC audio transport, processes speech through Silero VAD, Speaches STT, vLLM, and Speaches TTS, supports barge-in interruption, and exposes per-stage latency metrics via Prometheus. It runs as a CPU-only pod alongside colocated GPU services.

## Glossary

- **Orchestrator**: The Pipecat-based Python voice agent that coordinates all pipeline stages and manages audio flow between them
- **Pipeline**: The sequential audio processing chain: VAD → STT → LLM → TTS
- **VAD**: Voice Activity Detection — Silero VAD running in-process within Pipecat to detect speech start and end
- **STT**: Speech-to-Text — Speaches server exposing an OpenAI-compatible `/v1/audio/transcriptions` endpoint (Faster-Whisper large-v3-turbo)
- **LLM**: Large Language Model — vLLM server exposing an OpenAI-compatible `/v1/chat/completions` endpoint (Llama 3.1 8B Instruct AWQ)
- **TTS**: Text-to-Speech — Speaches server exposing an OpenAI-compatible `/v1/audio/speech` endpoint (Kokoro 82M)
- **Barge-in**: User interruption during active TTS playback, which cancels the current response and processes the new utterance
- **LiveKit_Transport**: The Pipecat LiveKit plugin that provides WebRTC audio input/output via a LiveKit room
- **Silence_Threshold**: The duration of silence (in milliseconds) after speech that triggers end-of-utterance detection
- **Stage_Latency**: The time taken by a single pipeline stage (VAD, STT, LLM, or TTS) to process its input
- **End_to_End_Latency**: The total time from end of user speech (VAD trigger) to first audio byte of the TTS response reaching the user
- **Metrics_Endpoint**: The HTTP `/metrics` endpoint serving Prometheus-formatted metrics
- **ConfigMap**: Kubernetes ConfigMap providing service endpoint URLs and model configuration as environment variables

## Requirements

### Requirement 1: LiveKit Room Connection

**User Story:** As a browser client user, I want the orchestrator to connect to a LiveKit room, so that I can send and receive real-time audio via WebRTC.

#### Acceptance Criteria

1. WHEN the Orchestrator process starts, THE Orchestrator SHALL connect to the LiveKit room using the LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET environment variables within 10 seconds of process initialization
2. WHEN a participant joins the LiveKit room, THE Orchestrator SHALL subscribe to the participant's audio track and forward incoming audio frames to the speech-to-text processing stage
3. WHEN the Orchestrator produces TTS audio output, THE Orchestrator SHALL publish the audio frames to the LiveKit room with a transport latency of no more than 200 milliseconds from frame generation to participant delivery
4. IF the LiveKit connection fails, THEN THE Orchestrator SHALL log the error with the connection details and retry with exponential backoff starting at 1 second, doubling each attempt, up to a maximum of 5 attempts
5. IF all 5 LiveKit connection retry attempts are exhausted, THEN THE Orchestrator SHALL log a final connection failure and terminate the process with a non-zero exit code
6. IF any of the required environment variables (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) are missing or empty at startup, THEN THE Orchestrator SHALL terminate immediately with a non-zero exit code and log an error message indicating which variable is missing

### Requirement 2: Voice Activity Detection

**User Story:** As a voice pipeline operator, I want the orchestrator to detect speech boundaries using Silero VAD, so that only complete utterances are sent to STT.

#### Acceptance Criteria

1. THE Orchestrator SHALL run Silero VAD in-process to detect speech start and speech end in the incoming 16 kHz, 16-bit mono PCM audio stream
2. THE Orchestrator SHALL use a configurable Silence_Threshold (via the VAD_SILENCE_THRESHOLD_MS environment variable) with a default value of 200 milliseconds and an accepted range of 100 to 2000 milliseconds
3. WHEN the VAD detects end-of-speech (silence persists for at least Silence_Threshold milliseconds after speech), THE Orchestrator SHALL forward the accumulated audio segment to the STT stage only if the segment duration is at least 100 milliseconds
4. WHILE the VAD has not detected speech start, THE Orchestrator SHALL discard incoming audio frames without forwarding them to subsequent pipeline stages
5. IF the VAD_SILENCE_THRESHOLD_MS environment variable contains a non-integer or out-of-range value, THEN THE Orchestrator SHALL exit with a non-zero status code and log an error message indicating the invalid value and the expected range of 100 to 2000 milliseconds

### Requirement 3: Speech-to-Text Processing

**User Story:** As a voice pipeline operator, I want the orchestrator to transcribe speech using the Speaches STT service, so that the LLM receives text input.

#### Acceptance Criteria

1. WHEN the VAD produces a complete audio segment, THE Orchestrator SHALL send it to the STT service at the URL specified by the STT_BASE_URL environment variable using the OpenAI-compatible `/v1/audio/transcriptions` endpoint, with the audio encoded as 16kHz mono PCM
2. THE Orchestrator SHALL use the model specified by the STT_MODEL environment variable for transcription requests
3. WHEN the STT service returns a transcription result containing at least one non-whitespace character, THE Orchestrator SHALL forward the text to the LLM stage
4. IF the STT service returns an empty or whitespace-only transcription, THEN THE Orchestrator SHALL discard the result and not forward any text to the LLM stage
5. IF the STT service returns an error or fails to respond within 10 seconds, THEN THE Orchestrator SHALL log the error including the failure reason and discard the audio segment
6. IF the STT_BASE_URL environment variable is not set at startup, THEN THE Orchestrator SHALL fail to start and log an error indicating the missing configuration. IF STT_MODEL is not set, THE Orchestrator SHALL use an empty string as the model parameter (allowing the STT service to use its default model)

### Requirement 4: LLM Response Generation

**User Story:** As a voice pipeline operator, I want the orchestrator to generate conversational responses using vLLM streaming completions, so that the TTS can synthesize speech from the response.

#### Acceptance Criteria

1. WHEN the STT stage produces transcribed text, THE Orchestrator SHALL send it as a chat completion request to the LLM service at the URL specified by the LLM_BASE_URL environment variable using the OpenAI-compatible `/v1/chat/completions` endpoint with streaming enabled and a request timeout of 10 seconds
2. THE Orchestrator SHALL use the model specified by the LLM_MODEL environment variable for completion requests
3. WHILE the LLM streams response tokens, THE Orchestrator SHALL forward text to the TTS stage each time a sentence boundary is detected (period, exclamation mark, or question mark followed by a space or end of stream)
4. THE Orchestrator SHALL maintain conversation context (system prompt and message history) across turns within a session, retaining up to the most recent 20 messages (10 user–assistant pairs) or the maximum token count supported by the model context window (4096 tokens), whichever limit is reached first
5. IF the LLM service is unreachable or returns an error during streaming, THEN THE Orchestrator SHALL discard any partial response for that turn, log the failure, and not forward incomplete text to the TTS stage

### Requirement 5: Text-to-Speech Synthesis

**User Story:** As a browser client user, I want the orchestrator to synthesize speech from LLM responses using the Speaches TTS service, so that I hear natural voice responses.

#### Acceptance Criteria

1. WHEN the LLM stage produces a complete sentence of text, THE Orchestrator SHALL send an HTTP POST request to the TTS service at `{TTS_BASE_URL}/v1/audio/speech` with the sentence text and the model specified by the TTS_MODEL environment variable
2. THE Orchestrator SHALL include the TTS_MODEL environment variable value as the model parameter in every synthesis request to the `/v1/audio/speech` endpoint
3. WHEN the TTS service returns audio data, THE Orchestrator SHALL begin streaming the audio frames to the LiveKit room audio track within 200 milliseconds of receiving the first audio byte
4. WHILE the LLM is still generating text, THE Orchestrator SHALL dispatch TTS requests for each completed sentence without waiting for the full LLM response, so that audio playback of earlier sentences overlaps with LLM generation of later sentences
5. IF the TTS service returns an error or does not respond within 5 seconds, THEN THE Orchestrator SHALL skip the affected sentence, log the failure, and continue processing subsequent sentences without interrupting ongoing audio playback

### Requirement 6: Barge-in Handling

**User Story:** As a browser client user, I want to interrupt the AI response mid-sentence, so that the agent stops speaking and processes my new input immediately.

#### Acceptance Criteria

1. WHILE the Orchestrator is playing TTS audio output, WHEN the VAD detects new speech from the user, THE Orchestrator SHALL cancel the active TTS playback and terminate the in-progress LLM stream within 500ms of barge-in detection
2. WHEN a barge-in event occurs, THE Orchestrator SHALL discard any pending LLM tokens and queued TTS audio that have not yet been played, ensuring no further audio from the interrupted turn is sent to the client
3. WHEN a barge-in event occurs, THE Orchestrator SHALL process the new user utterance through the full pipeline (VAD → STT → LLM → TTS) as a new turn, preserving the conversation history up to the point of interruption as context for the LLM
4. IF a barge-in event occurs but the new user utterance produces no transcribable speech from STT, THEN THE Orchestrator SHALL remain silent and resume listening for the next user utterance without replaying the interrupted response

### Requirement 7: Per-Stage Latency Instrumentation

**User Story:** As a voice pipeline operator, I want per-stage latency metrics exposed via Prometheus, so that I can monitor and optimize each pipeline component.

#### Acceptance Criteria

1. THE Orchestrator SHALL record the wall-clock processing duration of each pipeline stage (VAD, STT, LLM, TTS), measured from the moment input is dispatched to the stage until the stage produces its first output, as a Prometheus histogram metric named `voice_pipeline_stage_duration_seconds` with a `stage` label whose value matches the stage name (vad, stt, llm, tts)
2. THE Orchestrator SHALL record the end-to-end latency (from VAD end-of-speech trigger to first TTS audio byte output) as a Prometheus histogram metric named `voice_pipeline_e2e_latency_seconds`
3. THE Orchestrator SHALL expose all metrics in Prometheus text exposition format via an HTTP endpoint at `/metrics` on the port specified by the METRICS_PORT environment variable (default: 8080), and the endpoint SHALL return HTTP 200 with a valid response within 500ms of the Orchestrator process completing startup
4. THE Orchestrator SHALL use histogram buckets appropriate for voice latency measurement: 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0 seconds
5. IF a pipeline stage completes with an error, THEN THE Orchestrator SHALL still record the elapsed duration for that stage in `voice_pipeline_stage_duration_seconds` and SHALL include an additional `status` label with value "error" (nominal completions SHALL use `status` label value "ok")
6. IF the METRICS_PORT environment variable is not set, THEN THE Orchestrator SHALL default to port 8080. IF the METRICS_PORT environment variable contains a non-integer value or a value outside the range 1–65535, THEN THE Orchestrator SHALL exit with a non-zero status code and log an error message identifying the invalid value

### Requirement 8: Environment-Based Configuration

**User Story:** As a Kubernetes operator, I want the orchestrator to read all configuration from environment variables, so that I can configure it via ConfigMap without rebuilding the container image.

#### Acceptance Criteria

1. WHEN the Orchestrator starts, THE Orchestrator SHALL read service endpoint URLs from the STT_BASE_URL, TTS_BASE_URL, and LLM_BASE_URL environment variables and use them for all subsequent service communication
2. WHEN the Orchestrator starts, THE Orchestrator SHALL read model identifiers from the STT_MODEL, TTS_MODEL, and LLM_MODEL environment variables, applying empty string as the default when any model variable is unset
3. WHEN the Orchestrator starts, THE Orchestrator SHALL read LiveKit connection parameters from the LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET environment variables
4. WHEN the Orchestrator starts, THE Orchestrator SHALL read the VAD silence threshold from the VAD_SILENCE_THRESHOLD_MS environment variable as an integer between 100 and 2000 inclusive (default: 200)
5. WHEN the Orchestrator starts, THE Orchestrator SHALL read the metrics port from the METRICS_PORT environment variable as an integer between 1 and 65535 inclusive (default: 8080)
6. IF a required environment variable (STT_BASE_URL, TTS_BASE_URL, LLM_BASE_URL, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) is missing at startup, THEN THE Orchestrator SHALL exit with a non-zero status code and log an error message naming each missing variable
7. IF VAD_SILENCE_THRESHOLD_MS or METRICS_PORT contains a non-integer value or a value outside its valid range, THEN THE Orchestrator SHALL exit with a non-zero status code and log an error message identifying the invalid variable and its expected range
8. THE Orchestrator SHALL not read configuration from any file on the filesystem and SHALL rely exclusively on environment variables for all operator-configurable parameters

### Requirement 9: Containerized Deployment

**User Story:** As a DevOps engineer, I want the orchestrator packaged as a Docker container, so that I can deploy it on EKS alongside the other pipeline services.

#### Acceptance Criteria

1. THE Orchestrator SHALL be packaged in a Docker image based on Python 3.11-slim and SHALL run the container process as a non-root user
2. THE Orchestrator container image SHALL include the following Python dependencies: Pipecat SDK (>=1.0.0), LiveKit plugin, LiveKit API client, Prometheus client, and OpenAI client library, each importable without error when the container starts
3. THE Orchestrator container SHALL listen on TCP port 8080 by default, serving a `/health` HTTP endpoint that returns a 200 status code when the agent process is ready to accept connections
4. THE Orchestrator container SHALL start the agent process as the entrypoint without requiring additional command-line arguments, reading all configuration from environment variables (STT_BASE_URL, TTS_BASE_URL, LLM_BASE_URL, LLM_MODEL, STT_MODEL, TTS_MODEL)
5. IF a required environment variable is missing at container startup, THEN THE Orchestrator SHALL exit with a non-zero exit code within 5 seconds and log an error message indicating which variable is missing
6. THE Orchestrator container image SHALL have a final compressed size of no more than 500 MB, excluding any model files downloaded at runtime
7. WHEN the Orchestrator receives a SIGTERM signal, THE Orchestrator SHALL gracefully disconnect from the LiveKit room and terminate the pipeline within 10 seconds, ensuring no audio frames are sent after disconnection begins
