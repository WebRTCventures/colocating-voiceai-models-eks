'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  LocalAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Track,
  DisconnectReason,
} from 'livekit-client';
import type { ConnectionState, TokenResponse } from '../types';

export interface UseRoomReturn {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Error message, null when no error */
  error: string | null;
  /** LiveKit Room instance, null when not connected */
  room: Room | null;
  /** Local microphone audio track */
  localTrack: LocalAudioTrack | null;
  /** Remote (agent) audio track */
  remoteTrack: RemoteTrack | null;
  /** Connect to the LiveKit room */
  connect: () => Promise<void>;
  /** Disconnect from the LiveKit room */
  disconnect: () => void;
  /** Toggle mute on local audio track */
  toggleMute: () => Promise<void>;
  /** Whether the local audio track is muted */
  isMuted: boolean;
}

/**
 * Hook that manages the full lifecycle of a LiveKit Room connection.
 *
 * Handles: parallel mic acquisition + token fetch, room connection with SDK
 * timeouts, event subscriptions, mic publishing, disconnect cleanup, and mute toggle.
 *
 * Exposes the Room instance so other hooks (useLatencyData, useDeploymentMode)
 * can attach their own event listeners to it.
 */
export function useRoom(): UseRoomReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [localTrack, setLocalTrack] = useState<LocalAudioTrack | null>(null);
  const [remoteTrack, setRemoteTrack] = useState<RemoteTrack | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);

  const roomRef = useRef<Room | null>(null);

  const cleanup = useCallback(() => {
    const currentRoom = roomRef.current;
    if (currentRoom) {
      // Remove all event listeners
      currentRoom.removeAllListeners();
      roomRef.current = null;
    }
    setRoom(null);
    setLocalTrack(null);
    setRemoteTrack(null);
    setIsMuted(false);
  }, []);

  const disconnect = useCallback(() => {
    const currentRoom = roomRef.current;
    if (currentRoom) {
      // Stop local tracks
      currentRoom.localParticipant.audioTrackPublications.forEach((pub) => {
        if (pub.track) {
          pub.track.stop();
        }
      });
      currentRoom.disconnect();
    }
    cleanup();
    setConnectionState('disconnected');
    setError(null);
  }, [cleanup]);

  const connect = useCallback(async () => {
    // Prevent duplicate connection attempts
    if (connectionState === 'connecting' || connectionState === 'connected') {
      return;
    }

    setConnectionState('connecting');
    setError(null);

    // Create a new Room instance
    const newRoom = new Room();
    roomRef.current = newRoom;
    setRoom(newRoom);

    // Subscribe to room events
    newRoom.on(RoomEvent.Connected, () => {
      setConnectionState('connected');
    });

    newRoom.on(RoomEvent.Disconnected, (_reason?: DisconnectReason) => {
      cleanup();
      setConnectionState('disconnected');
    });

    newRoom.on(RoomEvent.Reconnecting, () => {
      setConnectionState('reconnecting');
    });

    newRoom.on(RoomEvent.Reconnected, () => {
      setConnectionState('connected');
    });

    newRoom.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          setRemoteTrack(track);
        }
      },
    );

    newRoom.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          setRemoteTrack(null);
        }
      },
    );

    newRoom.on(RoomEvent.MediaDevicesError, (err: Error) => {
      setError(`Microphone error: ${err.message}`);
      // Disconnect on media device error
      disconnect();
    });

    // Parallel: fetch token + acquire microphone
    try {
      const [tokenResult, micStream] = await Promise.all([
        fetch('/api/token').then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(body.error || 'Could not obtain token');
          }
          return res.json() as Promise<TokenResponse>;
        }),
        navigator.mediaDevices.getUserMedia({ audio: true }).catch((err: Error) => {
          throw new Error(`Microphone access required: ${err.message}`);
        }),
      ]);

      // Connect to the room with SDK timeout options
      await newRoom.connect(tokenResult.url, tokenResult.token, {
        peerConnectionTimeout: 5000,
        websocketTimeout: 5000,
      });

      // Publish mic track with voice-optimized settings
      const audioTrack = micStream.getAudioTracks()[0];
      const lkTrack = new LocalAudioTrack(audioTrack);
      await newRoom.localParticipant.publishTrack(lkTrack, {
        source: Track.Source.Microphone,
        dtx: true,
        red: true,
        audioPreset: { maxBitrate: 32000 },
      });

      setLocalTrack(lkTrack);
      setIsMuted(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      cleanup();
      setConnectionState('disconnected');
    }
  }, [connectionState, cleanup, disconnect]);

  const toggleMute = useCallback(async () => {
    if (!localTrack) return;

    if (localTrack.isMuted) {
      await localTrack.unmute();
      setIsMuted(false);
    } else {
      await localTrack.mute();
      setIsMuted(true);
    }
  }, [localTrack]);

  return {
    connectionState,
    error,
    room,
    localTrack,
    remoteTrack,
    connect,
    disconnect,
    toggleMute,
    isMuted,
  };
}
