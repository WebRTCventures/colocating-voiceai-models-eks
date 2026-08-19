'use client';

import { useRef } from 'react';
import { LocalAudioTrack } from 'livekit-client';
import { useAudioVisualization } from '../hooks/useAudioVisualization';

interface UserMicIndicatorProps {
  localTrack: LocalAudioTrack | null;
  isMuted: boolean;
}

/**
 * Small mic indicator showing the user's audio level.
 * Compact horizontal bar visualization below the call controls.
 */
export default function UserMicIndicator({ localTrack, isMuted }: UserMicIndicatorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useAudioVisualization(canvasRef, localTrack);

  if (!localTrack) return null;

  return (
    <div className="flex items-center gap-2">
      <svg
        className={`w-4 h-4 ${isMuted ? 'text-red-400' : 'text-[var(--accent-gold)]'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
      </svg>
      <div className="rounded-full overflow-hidden bg-[var(--surface)] border border-[var(--border)]">
        <canvas
          ref={canvasRef}
          className="w-[120px] h-[20px] block"
        />
      </div>
      <span className="text-xs text-[var(--foreground)]/50">
        {isMuted ? 'Muted' : 'Your mic'}
      </span>
    </div>
  );
}
