'use client';

import { useEffect, useRef, useMemo } from 'react';
import { RemoteTrack, RemoteAudioTrack } from 'livekit-client';
import { useRoom } from './hooks/useRoom';
import { useLatencyData } from './hooks/useLatencyData';
import { useDeploymentMode } from './hooks/useDeploymentMode';
import ConnectionControls from './components/ConnectionControls';
import { AudioVisualization } from './components/AudioVisualization';
import LatencyDisplay from './components/LatencyDisplay';
import DeploymentBadge from './components/DeploymentBadge';
import StatusBar from './components/StatusBar';

export default function Home() {
  const {
    connectionState,
    error,
    room,
    localTrack,
    remoteTrack,
    connect,
    disconnect,
    toggleMute,
    isMuted,
  } = useRoom();

  const latencyData = useLatencyData(room);
  const mode = useDeploymentMode(room);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Attach remote audio track to hidden <audio> element for playback
  useEffect(() => {
    const audioEl = audioRef.current;
    if (remoteTrack && audioEl) {
      (remoteTrack as RemoteTrack).attach(audioEl);
      audioEl.play().catch(() => {});
    }
    return () => {
      if (remoteTrack && audioEl) {
        (remoteTrack as RemoteTrack).detach(audioEl);
      }
    };
  }, [remoteTrack]);

  // Derive agent presence from room's remote participants
  const agentPresent = useMemo(() => {
    if (!room) return false;
    let found = false;
    room.remoteParticipants.forEach((participant) => {
      if (participant.identity.startsWith('agent-')) {
        found = true;
      }
    });
    return found;
  }, [room, connectionState, remoteTrack]);

  return (
    <main className="flex flex-1 flex-col items-center gap-6 p-8">
      {/* Header */}
      <header className="flex flex-col items-center gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Voice AI Latency Demo
        </h1>
        <p className="text-sm text-zinc-400">
          Real-time voice AI latency demonstration — colocated vs distributed inference on EKS
        </p>
      </header>

      {/* Connection Controls */}
      <ConnectionControls
        state={connectionState}
        isMuted={isMuted}
        onConnect={connect}
        onDisconnect={disconnect}
        onToggleMute={toggleMute}
      />

      {/* Audio Visualization */}
      <AudioVisualization
        localTrack={localTrack}
        remoteTrack={remoteTrack as RemoteAudioTrack | null}
      />

      {/* Deployment Badge + Latency Display */}
      <div className="flex flex-col items-center gap-4">
        <DeploymentBadge mode={mode} />
        <LatencyDisplay latencyData={latencyData} />
      </div>

      {/* Status Bar (at bottom) */}
      <div className="mt-auto w-full rounded-b-lg">
        <StatusBar
          state={connectionState}
          error={error}
          agentPresent={agentPresent}
        />
      </div>

      {/* Hidden audio element for remote track playback */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </main>
  );
}
