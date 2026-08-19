'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Room } from 'livekit-client';

export interface TranscriptEntry {
  /** Unique ID based on segment_id or auto-generated */
  id: string;
  /** Who said it — 'user' or 'agent' */
  speaker: 'user' | 'agent';
  /** The transcribed text */
  text: string;
  /** Timestamp when received */
  timestamp: number;
  /** Whether this is the final transcription for this segment */
  isFinal: boolean;
}

/**
 * Hook that listens for transcription text streams on a LiveKit Room.
 *
 * The LiveKit Agents framework automatically publishes transcriptions on the
 * `lk.transcription` topic. Each transcription stream includes attributes:
 * - `lk.transcribed_track_id`: ID of the audio track being transcribed
 * - `lk.transcription_final`: "true" when the segment is complete
 * - `lk.segment_id`: unique ID for this speech segment
 *
 * The sender identity indicates who is being transcribed (user or agent).
 */
export function useTranscript(room: Room | null): TranscriptEntry[] {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const registeredRef = useRef(false);

  // Reset on disconnect
  useEffect(() => {
    if (!room) {
      setEntries([]);
      registeredRef.current = false;
    }
  }, [room]);

  const registerHandler = useCallback(() => {
    if (!room || registeredRef.current) return;

    try {
      room.registerTextStreamHandler('lk.transcription', async (reader, participantInfo) => {
        const text = await reader.readAll();
        if (!text.trim()) return;

        const attributes = reader.info.attributes || {};
        const isFinal = attributes['lk.transcription_final'] === 'true';
        const segmentId = attributes['lk.segment_id'] || `seg-${Date.now()}`;

        // Determine if this is from the agent or user
        const isAgent = participantInfo.identity.startsWith('agent-');
        const speaker: 'user' | 'agent' = isAgent ? 'agent' : 'user';

        const entry: TranscriptEntry = {
          id: `${participantInfo.identity}-${segmentId}`,
          speaker,
          text: text.trim(),
          timestamp: Date.now(),
          isFinal,
        };

        setEntries((prev) => {
          // Replace interim entry with same id, or append new
          const existingIdx = prev.findIndex((e) => e.id === entry.id);
          if (existingIdx >= 0) {
            const updated = [...prev];
            updated[existingIdx] = entry;
            return updated;
          }
          return [...prev, entry];
        });
      });
      registeredRef.current = true;
    } catch {
      // Handler might already be registered — silently ignore
    }
  }, [room]);

  useEffect(() => {
    registerHandler();

    return () => {
      if (room && registeredRef.current) {
        try {
          room.unregisterTextStreamHandler('lk.transcription');
        } catch {
          // Ignore if already unregistered
        }
        registeredRef.current = false;
      }
    };
  }, [room, registerHandler]);

  return entries;
}
