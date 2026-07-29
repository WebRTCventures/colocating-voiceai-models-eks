'use client';

import { useEffect, useState } from 'react';
import { Room, RoomEvent, RemoteParticipant, LocalParticipant } from 'livekit-client';
import { DeploymentMode } from '../types';

const AGENT_IDENTITY = 'voice-agent';

/**
 * Pure function to parse deployment mode from participant metadata.
 * Exported for independent testing.
 */
export function parseDeploymentMode(metadata: string | undefined): DeploymentMode {
  if (!metadata) return 'unknown';
  try {
    const parsed = JSON.parse(metadata);
    if (parsed.deployment_mode === 'colocated' || parsed.deployment_mode === 'distributed') {
      return parsed.deployment_mode;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Hook that monitors the voice-agent participant's metadata to determine
 * the current deployment mode (colocated, distributed, or unknown).
 *
 * @param room - LiveKit Room instance, or null if not connected
 * @returns Current deployment mode
 */
export function useDeploymentMode(room: Room | null): DeploymentMode {
  const [mode, setMode] = useState<DeploymentMode>('unknown');

  useEffect(() => {
    if (!room) {
      setMode('unknown');
      return;
    }

    // Check existing remote participants for voice-agent
    const checkExistingParticipants = () => {
      room.remoteParticipants.forEach((participant) => {
        if (participant.identity === AGENT_IDENTITY) {
          setMode(parseDeploymentMode(participant.metadata));
        }
      });
    };

    checkExistingParticipants();

    // Handle new participant joining
    const handleParticipantConnected = (participant: RemoteParticipant) => {
      if (participant.identity === AGENT_IDENTITY) {
        setMode(parseDeploymentMode(participant.metadata));
      }
    };

    // Handle metadata changes on any participant
    const handleMetadataChanged = (
      metadata: string | undefined,
      participant: RemoteParticipant | LocalParticipant
    ) => {
      if (participant.identity === AGENT_IDENTITY) {
        setMode(parseDeploymentMode(metadata));
      }
    };

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantMetadataChanged, handleMetadataChanged);

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantMetadataChanged, handleMetadataChanged);
    };
  }, [room]);

  return mode;
}
