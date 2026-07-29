'use client';

import { useRef } from 'react';
import { LocalAudioTrack, RemoteAudioTrack } from 'livekit-client';
import { useAudioVisualization } from '../hooks/useAudioVisualization';

interface AudioVisualizationProps {
  localTrack: LocalAudioTrack | null;
  remoteTrack: RemoteAudioTrack | null;
}

/**
 * Renders two side-by-side (or stacked on narrow screens) audio visualization
 * canvas panels: one for the local microphone ("You") and one for the remote
 * AI agent ("Agent"). Each canvas uses the useAudioVisualization hook to drive
 * real-time frequency bar rendering.
 */
export function AudioVisualization({ localTrack, remoteTrack }: AudioVisualizationProps) {
  const localCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const remoteCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useAudioVisualization(localCanvasRef, localTrack);
  useAudioVisualization(remoteCanvasRef, remoteTrack);

  return (
    <div className="flex flex-col sm:flex-row gap-4 w-full">
      {/* Local mic visualization */}
      <div className="flex-1 flex flex-col items-center gap-1">
        <span className="text-xs text-gray-400 uppercase tracking-wide">You</span>
        <div className="rounded-lg border border-gray-700 bg-[#0a0a0a] p-1">
          <canvas
            ref={localCanvasRef}
            className="min-w-[200px] min-h-[80px] w-[300px] h-[100px] block"
          />
        </div>
      </div>

      {/* Remote agent visualization */}
      <div className="flex-1 flex flex-col items-center gap-1">
        <span className="text-xs text-gray-400 uppercase tracking-wide">Agent</span>
        <div className="rounded-lg border border-gray-700 bg-[#0a0a0a] p-1">
          <canvas
            ref={remoteCanvasRef}
            className="min-w-[200px] min-h-[80px] w-[300px] h-[100px] block"
          />
        </div>
      </div>
    </div>
  );
}
