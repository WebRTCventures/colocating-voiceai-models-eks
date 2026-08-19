'use client';

import { useEffect, useRef, useMemo } from 'react';
import { RemoteTrack, RemoteAudioTrack } from 'livekit-client';
import { useRoom } from './hooks/useRoom';
import { useLatencyData } from './hooks/useLatencyData';
import { useDeploymentMode } from './hooks/useDeploymentMode';
import { useTranscript } from './hooks/useTranscript';
import AgentOrb from './components/AgentOrb';
import CallControls from './components/CallControls';
import UserMicIndicator from './components/UserMicIndicator';
import MetricsPanel from './components/MetricsPanel';
import TranscriptPanel from './components/TranscriptPanel';

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
  const transcript = useTranscript(room);

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

  const isConnected = connectionState === 'connected';

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 sm:p-8 min-h-full">
      {/* Restaurant branding header */}
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--accent-gold)]">
          The Golden Fork
        </h1>
        <p className="text-sm text-[var(--foreground)]/60 max-w-sm">
          AI Reservation Assistant — speak to book a table, ask about the menu, or make special requests
        </p>
      </header>

      {/* Agent orb — the central visual */}
      <AgentOrb
        remoteTrack={remoteTrack as RemoteAudioTrack | null}
        agentPresent={agentPresent}
        isConnected={isConnected}
      />

      {/* Call controls */}
      <CallControls
        state={connectionState}
        isMuted={isMuted}
        onConnect={connect}
        onDisconnect={disconnect}
        onToggleMute={toggleMute}
      />

      {/* User mic indicator */}
      <UserMicIndicator localTrack={localTrack} isMuted={isMuted} />

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-2 text-sm text-red-300" role="alert">
          {error}
        </div>
      )}

      {/* Info text when disconnected */}
      {connectionState === 'disconnected' && !error && (
        <p className="text-xs text-[var(--foreground)]/40 text-center max-w-xs">
          Tap the phone button to call. Open Tue–Sun, 5:30–10:30 PM.
        </p>
      )}

      {/* Transcript panel */}
      <TranscriptPanel entries={transcript} isConnected={isConnected} />

      {/* Metrics panel — technical overlay for the demo */}
      <div className="mt-auto w-full">
        <MetricsPanel
          latencyData={latencyData}
          mode={mode}
          isConnected={isConnected}
        />
      </div>

      {/* Hidden audio element for remote track playback */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </main>
  );
}
