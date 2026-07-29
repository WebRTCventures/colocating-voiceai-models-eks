# Implementation Plan: Browser Voice Client

## Overview

Build a Next.js application in `client/` that connects to a LiveKit room via WebRTC, captures microphone audio, plays back AI-generated speech, displays per-stage latency metrics, renders audio visualization on canvas elements, and shows the deployment mode. The app uses `livekit-client` SDK directly (not component library), Tailwind CSS for dark-theme styling, and is packaged as a Docker container with standalone output.

## Tasks

- [x] 1. Project scaffolding and configuration
  - [x] 1.1 Initialize Next.js project with TypeScript and Tailwind CSS
    - Run `npx create-next-app@latest client --typescript --tailwind --app --no-src-dir --no-import-alias` in the workspace root
    - Install dependencies: `livekit-client`, `livekit-server-sdk`, `fast-check` (dev)
    - Configure `next.config.ts` with `output: 'standalone'`
    - Configure Tailwind for dark theme defaults
    - Set up Vitest with `@vitejs/plugin-react` for testing
    - Create `.env.local.example` documenting LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
    - _Requirements: 7.1, 10.2, 10.3, 10.6_

  - [x] 1.2 Define TypeScript interfaces and types
    - Create `client/app/types.ts` with: `TokenResponse`, `TokenError`, `LatencyMessage`, `LatencyData`, `ConnectionState`, `ConnectionStatus`, `AgentMetadata`, `DeploymentMode`
    - Ensure all interfaces match the data models in the design document
    - _Requirements: 4.1, 5.2, 8.2_

- [x] 2. API routes
  - [x] 2.1 Implement `/api/token` route
    - Create `client/app/api/token/route.ts`
    - Use `livekit-server-sdk` `AccessToken` to generate JWT with grants: roomJoin, room "voice-agent-room", canPublish, canSubscribe, canPublishData=false
    - Return `{ token, url }` JSON with the LIVEKIT_URL from env
    - Generate unique participant identity with `user-${crypto.randomUUID().slice(0, 8)}`
    - Set TTL to 6 hours
    - Return 500 if env vars missing, 405 for non-GET methods
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 2.2 Implement `/api/health` route
    - Create `client/app/api/health/route.ts`
    - Return 200 `{ status: 'ok' }` when all env vars present
    - Return 503 `{ status: 'unhealthy', reason: 'missing env vars' }` when any are missing
    - _Requirements: 10.7, 10.8_

  - [ ]* 2.3 Write property tests for token and health endpoints
    - **Property 4: Token endpoint produces valid JWT with correct grants**
    - **Property 5: Missing environment variables produce error responses**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 10.8**
    - Use fast-check to generate random non-empty env var combinations and verify JWT contents
    - Use fast-check to generate subsets of env vars with at least one missing and verify error responses

- [x] 3. Core hooks
  - [x] 3.1 Implement `useRoom` hook
    - Create `client/app/hooks/useRoom.ts`
    - Manage LiveKit Room instance lifecycle with `new Room()` creation
    - Implement connect flow: parallel mic acquisition (`getUserMedia`) + token fetch, then `room.connect(url, token, { peerConnectionTimeout: 5000, websocketTimeout: 5000 })`
    - Publish mic track with `{ dtx: true, red: true, audioBitrate: 32000 }`
    - Subscribe to RoomEvents: Connected, Disconnected, Reconnecting, Reconnected, TrackSubscribed, TrackUnsubscribed, DataReceived, ParticipantConnected, ParticipantMetadataChanged, ParticipantDisconnected, MediaDevicesError
    - Implement disconnect: stop local tracks, call `room.disconnect()`
    - Implement mute/unmute toggle on local audio track
    - Expose: `connectionState`, `error`, `room`, `localTrack`, `remoteTrack`, `connect()`, `disconnect()`, `toggleMute()`, `isMuted`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Implement `useLatencyData` hook
    - Create `client/app/hooks/useLatencyData.ts`
    - Parse DataReceived events for `type: "latency"` messages
    - Validate all numeric fields (vad_ms, stt_ms, llm_ms, tts_ms, total_ms) exist and are numbers
    - On valid message: update LatencyData state with rounded integer values
    - On invalid message: silently discard, retain previous values
    - Initialize all fields to `null` (displayed as "—")
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x] 3.3 Implement `useDeploymentMode` hook
    - Create `client/app/hooks/useDeploymentMode.ts`
    - Implement `parseDeploymentMode(metadata)` pure function
    - Read metadata from existing remote participants on connect
    - Listen for ParticipantConnected and ParticipantMetadataChanged events
    - Filter for participant with identity `voice-agent`
    - Return `'colocated' | 'distributed' | 'unknown'`
    - _Requirements: 5.2, 5.3, 5.4_

  - [x] 3.4 Implement `useAudioVisualization` hook
    - Create `client/app/hooks/useAudioVisualization.ts`
    - Use SDK's `createAudioAnalyser(track)` to get AnalyserNode
    - Configure: `fftSize: 256`, `smoothingTimeConstant: 0.7`, `minDecibels: -90`, `maxDecibels: -10`
    - Drive `requestAnimationFrame` loop at 60fps
    - Render frequency bars on canvas (first 30-40 bins for voice range)
    - Gradient colors: green (low) → cyan (high) on dark background
    - Handle zero-amplitude state (flat line when muted)
    - Apply `devicePixelRatio` scaling for HiDPI displays
    - Call `cleanup()` on analyser when track changes or component unmounts
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 3.5 Write property tests for latency parsing and deployment mode
    - **Property 2: Latency message parsing preserves valid data and rejects malformed input**
    - **Validates: Requirements 4.1, 4.2, 4.6**
    - Generate arbitrary JSON: valid latency objects, partial objects, non-JSON, wrong types
    - **Property 3: Deployment mode parsing returns correct value or "unknown"**
    - **Validates: Requirements 5.2, 5.3, 5.4**
    - Generate: valid metadata JSON, invalid JSON, undefined, wrong field values

- [x] 4. Checkpoint - Ensure hooks and API routes work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. UI components
  - [x] 5.1 Implement `ConnectionControls` component
    - Create `client/app/components/ConnectionControls.tsx`
    - Connect button (disabled when connecting or connected)
    - Disconnect button (enabled only when connected)
    - Mute/unmute toggle (enabled only when connected)
    - Visible hover state changes and disabled appearance per design
    - _Requirements: 1.1, 1.3, 1.7, 2.4, 2.5, 7.6_

  - [x] 5.2 Implement `AudioVisualization` component
    - Create `client/app/components/AudioVisualization.tsx`
    - Two canvas panels: "You" (local mic) and "Agent" (remote)
    - Each canvas minimum 200×80px, rendered at 300×100px
    - Use `useAudioVisualization` hook for each track
    - Positioned distinctly, no overlap, simultaneously visible
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.3 Implement `LatencyDisplay` component
    - Create `client/app/components/LatencyDisplay.tsx`
    - Display VAD, STT, LLM, TTS stages with labels and ms values
    - Display total with 1.5× font size emphasis
    - Show "—" when values are null
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [x] 5.4 Implement `DeploymentBadge` component
    - Create `client/app/components/DeploymentBadge.tsx`
    - Badge with distinct colors for colocated vs distributed
    - Display "Unknown" when mode is unknown
    - WCAG AA contrast ratio (4.5:1 minimum)
    - Fixed position above or adjacent to LatencyDisplay
    - _Requirements: 5.1, 5.4, 5.5_

  - [x] 5.5 Implement `StatusBar` component
    - Create `client/app/components/StatusBar.tsx`
    - Show connection state text
    - Show error messages when present
    - Show "Waiting for agent..." when connected but agent not present
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 3.3, 3.4_

- [x] 6. Main page assembly and layout
  - [x] 6.1 Build the main page component
    - Create `client/app/page.tsx` as the single-page dashboard
    - Wire all hooks: `useRoom`, `useLatencyData`, `useDeploymentMode`, `useAudioVisualization`
    - Compose all components: Header (title + subtitle), ConnectionControls, AudioVisualization, LatencyDisplay, DeploymentBadge, StatusBar
    - Attach remote audio via `track.attach()` to hidden `<audio>` element for playback
    - Resume AudioContext on connect gesture for autoplay compliance
    - _Requirements: 3.1, 7.2, 7.3, 7.5, 9.2_

  - [x] 6.2 Apply global layout and dark theme styling
    - Update `client/app/layout.tsx` with dark theme wrapper, metadata
    - Apply Tailwind dark background, light text, accent colors
    - Max content width 1280px, centered
    - Minimum 16px spacing between sections
    - Font sizes: 14px body minimum, 12px secondary labels minimum
    - No horizontal scroll at 1024px+ width, no vertical scroll at 768px+ height
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7_

  - [ ]* 6.3 Write property test for connection state machine
    - **Property 1: Connection state machine transitions are valid**
    - **Validates: Requirements 1.2, 1.3, 1.5, 1.6, 1.7**
    - Generate random sequences of events (Connected, Disconnected, Reconnecting, Reconnected, UserConnect, UserDisconnect)
    - Verify all resulting states are valid transitions per the state machine

- [x] 7. Dockerfile and containerization
  - [x] 7.1 Create multi-stage Dockerfile
    - Create `client/Dockerfile` with three stages: deps, builder, runner
    - Use `node:20-alpine` as base
    - Stage 1: `npm ci --only=production` for deps
    - Stage 2: `npm ci` + `npm run build` for builder
    - Stage 3: Copy standalone output, static files, public dir
    - Run as non-root user `nextjs` (UID 1001)
    - Expose port 3000, CMD `node server.js`
    - Add `.dockerignore` for node_modules, .next, .env*
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 8. Final checkpoint - Validate everything works together
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check + Vitest
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout; all implementations use TypeScript
- Remote audio playback requires both `track.attach()` (for speakers) and `createAudioAnalyser()` (for visualization) — these are independent paths
- The LiveKit URL is returned by `/api/token` at runtime — no `NEXT_PUBLIC_*` variables needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "3.2", "3.3", "3.4"] },
    { "id": 3, "tasks": ["3.5", "5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 4, "tasks": ["6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1"] }
  ]
}
```
