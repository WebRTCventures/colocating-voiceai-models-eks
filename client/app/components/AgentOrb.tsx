'use client';

import { useRef } from 'react';
import { RemoteAudioTrack } from 'livekit-client';
import { useAudioVisualization } from '../hooks/useAudioVisualization';

interface AgentOrbProps {
  remoteTrack: RemoteAudioTrack | null;
  agentPresent: boolean;
  isConnected: boolean;
}

/**
 * A circular orb representing the AI agent. When the agent speaks,
 * it glows and pulses. The canvas inside renders a radial frequency
 * visualization. When idle or disconnected it shows a static state.
 */
export default function AgentOrb({ remoteTrack, agentPresent, isConnected }: AgentOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useAudioVisualization(canvasRef, remoteTrack);

  const getOrbState = () => {
    if (!isConnected) return 'disconnected';
    if (!agentPresent) return 'waiting';
    if (remoteTrack) return 'speaking';
    return 'idle';
  };

  const orbState = getOrbState();

  const orbStyles: Record<string, string> = {
    disconnected: 'border-[var(--border)] bg-[var(--surface)]',
    waiting: 'border-[var(--accent-gold-dim)] bg-[var(--surface-raised)] agent-idle',
    idle: 'border-[var(--accent-gold)] bg-[var(--surface-raised)]',
    speaking: 'border-[var(--accent-gold)] bg-[var(--surface-raised)] agent-speaking',
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {/* The orb */}
      <div
        className={`relative w-32 h-32 sm:w-40 sm:h-40 rounded-full border-2 flex items-center justify-center overflow-hidden transition-all duration-500 ${orbStyles[orbState]}`}
        role="img"
        aria-label={`Agent status: ${orbState}`}
      >
        {/* Canvas for audio visualization inside the orb */}
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-full"
        />

        {/* Center icon overlay */}
        {orbState === 'disconnected' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-10 h-10 text-[var(--border-light)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </div>
        )}

        {orbState === 'waiting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-[var(--accent-gold-dim)] animate-ping" />
          </div>
        )}
      </div>

      {/* Agent label */}
      <span className="text-xs text-[var(--accent-gold)] uppercase tracking-widest font-medium">
        {orbState === 'disconnected' && 'Reservation Assistant'}
        {orbState === 'waiting' && 'Connecting…'}
        {orbState === 'idle' && 'Listening'}
        {orbState === 'speaking' && 'Speaking'}
      </span>
    </div>
  );
}
