/**
 * Shared TypeScript interfaces and types for the browser voice client.
 * These match the data models defined in the design document.
 */

/** GET /api/token success response */
export interface TokenResponse {
  /** Signed JWT string */
  token: string;
  /** LiveKit WebSocket URL (e.g., "ws://1.2.3.4:7880") */
  url: string;
}

/** Error response from /api/token (500 or 405) */
export interface TokenError {
  /** Human-readable error message */
  error: string;
}

/** JSON payload sent by orchestrator agent as a LiveKit data message */
export interface LatencyMessage {
  /** Message discriminator */
  type: "latency";
  /** VAD processing duration in milliseconds */
  vad_ms: number;
  /** Speech-to-text duration in milliseconds */
  stt_ms: number;
  /** LLM inference duration in milliseconds (time to first token) */
  llm_ms: number;
  /** Text-to-speech duration in milliseconds */
  tts_ms: number;
  /** End-to-end latency in milliseconds */
  total_ms: number;
}

/** Client-side parsed representation of latency data */
export interface LatencyData {
  /** VAD latency in ms, null if not yet received */
  vad: number | null;
  /** STT latency in ms, null if not yet received */
  stt: number | null;
  /** LLM latency in ms, null if not yet received */
  llm: number | null;
  /** TTS latency in ms, null if not yet received */
  tts: number | null;
  /** Total end-to-end latency in ms, null if not yet received */
  total: number | null;
}

/** Possible connection states for the LiveKit room */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Current connection status including error and agent presence */
export interface ConnectionStatus {
  /** Current connection state */
  state: ConnectionState;
  /** Error message for display, null when no error */
  error: string | null;
  /** Whether voice-agent participant is in room */
  agentPresent: boolean;
}

/** JSON metadata set by orchestrator when joining the LiveKit room */
export interface AgentMetadata {
  /** Deployment configuration mode */
  deployment_mode: "colocated" | "distributed";
}

/** Client-side deployment mode including the 'unknown' fallback */
export type DeploymentMode = 'colocated' | 'distributed' | 'unknown';
