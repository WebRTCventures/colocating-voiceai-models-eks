'use client';

import { useEffect, useState, useCallback } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { LatencyData } from '../types';

const INITIAL_LATENCY: LatencyData = {
  vad: null,
  stt: null,
  llm: null,
  tts: null,
  total: null,
};

/**
 * Parse an already-decoded value into LatencyData.
 * Exported as a pure function for independent property-based testing.
 *
 * Returns parsed LatencyData if the value is a valid latency message, null otherwise.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.6
 */
export function parseLatencyMessage(data: unknown): LatencyData | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== 'latency') return null;
  const fields = ['vad_ms', 'stt_ms', 'llm_ms', 'tts_ms', 'total_ms'];
  for (const field of fields) {
    if (typeof msg[field] !== 'number') return null;
  }
  return {
    vad: Math.round(msg.vad_ms as number),
    stt: Math.round(msg.stt_ms as number),
    llm: Math.round(msg.llm_ms as number),
    tts: Math.round(msg.tts_ms as number),
    total: Math.round(msg.total_ms as number),
  };
}

/**
 * Hook that listens for latency data messages on a LiveKit Room.
 * Returns the most recent valid LatencyData, with null fields until data arrives.
 *
 * On valid latency message: updates state with rounded integer values.
 * On invalid message: silently discards, retains previous values.
 */
export function useLatencyData(room: Room | null): LatencyData {
  const [latencyData, setLatencyData] = useState<LatencyData>(INITIAL_LATENCY);

  const handleDataReceived = useCallback((payload: Uint8Array) => {
    try {
      const text = new TextDecoder().decode(payload);
      const parsed = JSON.parse(text);
      const result = parseLatencyMessage(parsed);
      if (result) {
        setLatencyData(result);
      }
    } catch {
      // Silently discard unparseable payloads
    }
  }, []);

  useEffect(() => {
    if (!room) return;

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, handleDataReceived]);

  return latencyData;
}
