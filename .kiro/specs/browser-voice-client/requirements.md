# Requirements Document

## Introduction

This spec defines the Browser Client — a Next.js web application that provides a voice interface for interacting with the colocated voice AI pipeline on EKS. The client connects to a LiveKit room via WebRTC to send microphone audio and receive AI-generated speech responses. It displays real-time per-stage latency metrics (VAD, STT, LLM, TTS, and end-to-end), renders audio visualization, and indicates the current deployment mode (colocated vs. distributed). The UI is minimal and dashboard-like, suitable for blog post screenshots demonstrating sub-second voice AI latency.

## Glossary

- **Client**: The Next.js browser application that connects to a LiveKit room for real-time voice interaction
- **LiveKit_Room**: A LiveKit server room where both the browser client and the Pipecat orchestrator agent connect to exchange audio via WebRTC
- **LiveKit_Client_SDK**: The `livekit-client` JavaScript/TypeScript library used to connect to LiveKit rooms, publish audio tracks, and subscribe to remote audio tracks
- **Audio_Track**: A WebRTC media track carrying audio data (either a local microphone track published by the Client or a remote track from the orchestrator agent)
- **Latency_Data**: Per-stage timing information (VAD, STT, LLM, TTS durations and end-to-end total) sent from the orchestrator agent to the Client via LiveKit data messages
- **Data_Message**: A LiveKit data channel message sent between participants in a room, used by the orchestrator agent to transmit latency metrics to the Client
- **Deployment_Mode**: The current scheduling configuration of the voice pipeline — either "colocated" (all pods on the same node) or "distributed" (pods on separate nodes)
- **Audio_Visualization**: A visual representation of audio levels or waveform rendered on an HTML canvas element
- **Connection_State**: The current status of the Client's connection to the LiveKit room (disconnected, connecting, connected, reconnecting)
- **VoiceAgent_Component**: The React component responsible for managing microphone input, audio output, LiveKit room connection, and connection state display
- **LatencyDisplay_Component**: The React component that renders the per-stage and end-to-end latency breakdown updated after each voice interaction
- **Token_Endpoint**: A Next.js API route that generates a LiveKit access token for the Client to join a room

## Requirements

### Requirement 1: LiveKit Room Connection

**User Story:** As a demo user, I want to connect to a LiveKit room from the browser, so that I can exchange real-time audio with the voice AI agent.

#### Acceptance Criteria

1. WHEN the user clicks the connect button, THE Client SHALL request a LiveKit access token from the Token_Endpoint and connect to the LiveKit_Room using the LiveKit_Client_SDK within 5 seconds of the button click
2. WHEN the Client successfully connects to the LiveKit_Room, THE Client SHALL display the Connection_State as "connected" in the UI
3. WHILE the Client is connecting to the LiveKit_Room, THE Client SHALL display the Connection_State as "connecting" and disable the connect button to prevent duplicate connection attempts
4. IF the Token_Endpoint request fails or returns a non-200 response, THEN THE Client SHALL display an error message indicating the token could not be obtained and return to a "disconnected" state where the user can retry
5. IF the LiveKit_Room connection fails or the 5-second connection timeout elapses, THEN THE Client SHALL display an error message indicating the connection failure and return to a "disconnected" state where the user can retry
6. IF the Client loses connection to the LiveKit_Room unexpectedly, THEN THE Client SHALL display the Connection_State as "reconnecting" and attempt to reconnect automatically using the LiveKit_Client_SDK built-in reconnection mechanism for up to 30 seconds before returning to the "disconnected" state with an error message indicating the connection was lost
7. WHEN the user clicks the disconnect button while connected, THE Client SHALL leave the LiveKit_Room, stop all local Audio_Tracks, and display the Connection_State as "disconnected"

### Requirement 2: Audio Input (Microphone Capture)

**User Story:** As a demo user, I want to speak into my microphone and have my audio sent to the voice AI agent, so that the agent can process my speech.

#### Acceptance Criteria

1. WHEN the Client connects to the LiveKit_Room, THE Client SHALL request microphone access from the browser and publish the local audio track to the LiveKit_Room in an unmuted state
2. WHILE the Client is connected and the microphone is active, THE Client SHALL continuously stream microphone audio to the LiveKit_Room at the sample rate supported by the browser's audio capture (typically 48kHz)
3. IF the browser denies microphone permission after the Client initiates connection, THEN THE Client SHALL disconnect from the LiveKit_Room, display an error message indicating that microphone access is required, and return to a "disconnected" Connection_State
4. WHEN the user mutes the microphone via the mute button, THE Client SHALL stop publishing audio to the LiveKit_Room and display a visual indicator that the microphone is muted
5. WHEN the user unmutes the microphone, THE Client SHALL resume publishing audio to the LiveKit_Room and remove the muted visual indicator
6. IF the microphone device becomes unavailable during an active session (device disconnected or hardware failure), THEN THE Client SHALL display an error message indicating the microphone was lost and stop publishing the audio track to the LiveKit_Room

### Requirement 3: Audio Output (Agent Response Playback)

**User Story:** As a demo user, I want to hear the AI agent's voice response through my speakers, so that I can have a real-time conversation.

#### Acceptance Criteria

1. WHEN a remote participant (the orchestrator agent) publishes an Audio_Track in the LiveKit_Room, THE Client SHALL automatically subscribe to the track and begin playing audio through the default audio output device, using the prior user gesture from the connect action to satisfy browser autoplay policies
2. WHILE receiving audio from the remote participant, THE Client SHALL play audio with no additional buffering delay beyond the WebRTC jitter buffer managed by the LiveKit_Client_SDK
3. IF no remote audio track is available within 2 seconds of the Client completing its connection to the LiveKit_Room, THEN THE Client SHALL display a status message indicating it is waiting for the agent to join
4. WHEN the remote participant's audio track ends or the participant leaves the room, THE Client SHALL stop playback and display a status message indicating the agent has disconnected
5. WHEN a remote participant that previously disconnected publishes a new Audio_Track in the LiveKit_Room, THE Client SHALL subscribe to the new track and resume audio playback, replacing the disconnected status message with the connected state

### Requirement 4: Real-Time Latency Display

**User Story:** As a demo user, I want to see a breakdown of per-stage latency after each voice interaction, so that I can understand the performance of each pipeline component.

#### Acceptance Criteria

1. WHEN the orchestrator agent sends a Data_Message containing a JSON payload with `"type": "latency"` and numeric fields for each pipeline stage, THE LatencyDisplay_Component SHALL parse the message and display the individual stage durations (VAD, STT, LLM, TTS) and the end-to-end total latency within 500 milliseconds of receiving the data
2. THE LatencyDisplay_Component SHALL display each latency value in milliseconds, rounded to the nearest integer, with labels identifying each pipeline stage (VAD, STT, LLM, TTS, Total)
3. WHEN a new voice interaction completes and new Latency_Data arrives, THE LatencyDisplay_Component SHALL replace all previously displayed latency values with the values from the latest interaction
4. WHILE no Latency_Data has been received, THE LatencyDisplay_Component SHALL display a dash character ("—") for each stage to indicate data is not yet available
5. THE LatencyDisplay_Component SHALL display the end-to-end total latency with a font size at least 1.5 times larger than the individual stage values to visually distinguish the overall pipeline performance
6. IF a Data_Message with `"type": "latency"` is received but contains missing or non-numeric stage fields, THEN THE LatencyDisplay_Component SHALL retain the previously displayed values unchanged and discard the malformed message

### Requirement 5: Deployment Mode Indicator

**User Story:** As a demo user, I want to see which deployment mode (colocated or distributed) is currently active, so that I can understand the context of the latency numbers.

#### Acceptance Criteria

1. THE Client SHALL display the current Deployment_Mode as either "Colocated" or "Distributed" in a fixed position above or adjacent to the LatencyDisplay_Component, visible without scrolling on viewports 1024 pixels wide and above
2. WHEN the Client connects to the LiveKit_Room and the orchestrator agent participant is present, THE Client SHALL read the Deployment_Mode from the agent participant's metadata by parsing the `deployment_mode` field
3. WHEN the orchestrator agent participant joins the LiveKit_Room after the Client is already connected, THE Client SHALL read the Deployment_Mode from the agent participant's metadata within 1 second of the participant join event
4. IF the orchestrator agent participant's metadata does not contain the `deployment_mode` field or the field value is neither "colocated" nor "distributed", THEN THE Client SHALL display "Unknown" as the mode indicator
5. THE Client SHALL use a visually distinct badge for each Deployment_Mode: one color for "Colocated" and a different color for "Distributed", with a minimum contrast ratio of 4.5:1 against the background per WCAG AA

### Requirement 6: Audio Visualization

**User Story:** As a demo user, I want to see a visual representation of audio activity, so that I can confirm the microphone is capturing my voice and the agent is speaking.

#### Acceptance Criteria

1. WHILE the Client is connected and the microphone is active, THE Client SHALL render a real-time audio visualization (waveform or audio level meter) on an HTML canvas element reflecting the local microphone audio input levels, labeled "You" or "Microphone" to identify the source
2. WHILE receiving audio from the remote participant, THE Client SHALL render a real-time audio visualization reflecting the agent's audio output levels on a separate labeled canvas element (labeled "Agent") positioned distinctly from the local audio visualization so that both are simultaneously visible without overlap
3. WHILE at least one audio visualization is active, THE Client SHALL update the audio visualization at a minimum frame rate of 30 frames per second
4. WHEN the microphone is muted or no audio is being received, THE Client SHALL render the corresponding audio visualization at zero amplitude (all bars or waveform values at baseline) to indicate no audio activity
5. THE Client SHALL render each audio visualization canvas at a minimum resolution of 200 pixels wide and 80 pixels tall to provide sufficient visual detail for blog post screenshots

### Requirement 7: User Interface Design

**User Story:** As a blog post author, I want the client UI to be clean and visually appealing with a dark theme, so that screenshots look professional in the blog post.

#### Acceptance Criteria

1. THE Client SHALL use Tailwind CSS for all styling with a dark color theme (dark background, light text, accent colors for interactive elements)
2. THE Client SHALL arrange the UI in a single-page layout with visually separated sections for: connection controls, audio visualization, latency display, and deployment mode indicator, where each section is distinguished by spacing of at least 16 pixels or a visible border between adjacent sections
3. THE Client SHALL render all UI elements without horizontal scrolling on viewport widths of 1024 pixels and above, and without vertical scrolling on viewport heights of 768 pixels and above
4. THE Client SHALL use a consistent visual hierarchy with clear labels for every data value and control, readable font sizes (minimum 14px for body text, minimum 12px for secondary labels), and sufficient contrast ratios (WCAG AA minimum of 4.5:1 for normal text, 3:1 for large text and UI components)
5. THE Client SHALL display the project title "Voice AI Latency Demo" and a subtitle of no more than 120 characters describing the application as a real-time voice AI latency demonstration
6. THE Client SHALL visually distinguish interactive elements (buttons) from static content by displaying a visible state change on hover and a visually distinct disabled appearance when the element is not actionable
7. THE Client SHALL render the complete UI within a maximum content width of 1280 pixels, centered horizontally in the viewport

### Requirement 8: Token Generation API Route

**User Story:** As a browser client, I want to obtain a LiveKit access token from a server-side API route, so that I can securely connect to the LiveKit room without exposing API secrets in the browser.

#### Acceptance Criteria

1. THE Client application SHALL expose a Next.js API route at `/api/token` that generates a LiveKit access token granting permission to join the room named "voice-agent-room", publish and subscribe to audio tracks, and subscribe to data messages
2. WHEN the `/api/token` endpoint receives a GET request, THE Token_Endpoint SHALL generate a token with a unique participant identity (e.g., "user-" followed by a random suffix), using the LIVEKIT_API_KEY and LIVEKIT_API_SECRET environment variables, and return a JSON response with HTTP status 200 containing the fields `token` (the signed JWT string) and `url` (the LiveKit server WebSocket URL from the LIVEKIT_URL environment variable)
3. THE Token_Endpoint SHALL generate tokens with a time-to-live of 6 hours and permissions limited to: room join, audio publish, audio subscribe, and data subscribe (no video publish, no video subscribe, no data publish)
4. IF any of the required environment variables (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, or LIVEKIT_URL) are not configured or are empty, THEN THE Token_Endpoint SHALL return an HTTP 500 response with a JSON body containing an `error` field with a message indicating server misconfiguration
5. IF the `/api/token` endpoint receives a request with any HTTP method other than GET, THEN THE Token_Endpoint SHALL return an HTTP 405 response

### Requirement 9: Cross-Browser Compatibility

**User Story:** As a demo user, I want the client to work in Chrome and Firefox, so that I can use my preferred browser to interact with the voice agent.

#### Acceptance Criteria

1. THE Client SHALL support Google Chrome (version 120 and later) and Mozilla Firefox (version 120 and later) on desktop operating systems (macOS, Windows, Linux) such that all features — LiveKit room connection, microphone capture, audio playback, audio visualization, and latency display — produce identical functional results in both browsers
2. WHEN the user initiates a connection (user gesture), THE Client SHALL resume or create the AudioContext to comply with browser autoplay policies, ensuring audio playback begins without requiring additional user interaction after the initial connect action
3. THE Client SHALL request microphone permissions using the standard `getUserMedia` API supported by both Chrome and Firefox
4. IF the browser does not support a required API (WebRTC or Web Audio), THEN THE Client SHALL display a message indicating the browser is not supported and listing the supported browsers (Chrome 120+, Firefox 120+) before allowing a connection attempt
5. THE Client SHALL render the Audio_Visualization using the Web Audio API AnalyserNode in both Chrome and Firefox, producing visually equivalent output regardless of browser

### Requirement 10: Containerized Deployment

**User Story:** As a DevOps engineer, I want the client packaged as a Docker container, so that I can deploy it on EKS or run it locally pointing at the cluster.

#### Acceptance Criteria

1. THE Client SHALL be packaged in a Docker image using a multi-stage build with Node.js 20 as the build stage and a minimal runtime image for production serving, and the final image SHALL run the application process as a non-root user
2. THE Client container SHALL serve the Next.js application on port 3000, configurable via the PORT environment variable
3. THE Client container SHALL read LiveKit configuration (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) from environment variables at runtime without requiring a rebuild
4. THE Client container image SHALL have a final compressed size of no more than 500 MB
5. WHEN the Client container starts, THE Client SHALL begin serving HTTP requests within 10 seconds of container initialization
6. THE Client SHALL also support local development with `npm run dev` pointing at a remote LiveKit server URL provided via environment variable, without requiring Docker
7. THE Client container SHALL expose a health check endpoint at `/api/health` that returns HTTP 200 when the application is ready to serve requests, for use as a Kubernetes readiness and liveness probe
8. IF any required environment variable (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) is not set when the container starts, THEN THE Client SHALL log an error message indicating which variables are missing and the `/api/health` endpoint SHALL return a non-200 response

