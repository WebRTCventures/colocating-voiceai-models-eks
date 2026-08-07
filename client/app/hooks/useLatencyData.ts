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
 * Parse an already-decoded value into a partial LatencyData update.
 * Accepts messages with any subset of latency fields.
 * Returns parsed fields if the value is a valid latency message, null otherwise.
 */
export function parseLatencyMessage(data: unknown): Partial<LatencyData> | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== 'latency') return null;

  const result: Partial<LatencyData> = {};
  if (typeof msg.vad_ms === 'number') result.vad = Math.round(msg.vad_ms);
  if (typeof msg.stt_ms === 'number') result.stt = Math.round(msg.stt_ms);
  if (typeof msg.llm_ms === 'number') result.llm = Math.round(msg.llm_ms);
  if (typeof msg.tts_ms === 'number') result.tts = Math.round(msg.tts_ms);
  if (typeof msg.total_ms === 'number') result.total = Math.round(msg.total_ms);

  return Object.keys(result).length > 0 ? result : null;
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
        setLatencyData(prev => {
          const next = { ...prev, ...result };
          // Compute total from individual stages
          const stt = next.stt ?? 0;
          const llm = next.llm ?? 0;
          const tts = next.tts ?? 0;
          next.total = stt + llm + tts;
          return next;
        });
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
