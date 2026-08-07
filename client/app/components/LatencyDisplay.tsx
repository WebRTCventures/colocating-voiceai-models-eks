'use client';

import { LatencyData } from '../types';

interface LatencyDisplayProps {
  latencyData: LatencyData;
}

/** Format a latency value as "X ms" or "—" when null */
function formatMs(value: number | null): string {
  return value !== null ? `${Math.round(value)} ms` : '—';
}

const stages: { key: keyof Omit<LatencyData, 'total'>; label: string }[] = [
  { key: 'stt', label: 'STT' },
  { key: 'llm', label: 'LLM' },
  { key: 'tts', label: 'TTS' },
];

export default function LatencyDisplay({ latencyData }: LatencyDisplayProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      {/* Individual stages */}
      <div className="flex items-center gap-6">
        {stages.map((stage) => (
          <div key={stage.key} className="flex flex-col items-center gap-1">
            <span className="text-xs text-gray-400 uppercase tracking-wide">
              {stage.label}
            </span>
            <span className="text-sm text-gray-200 font-mono">
              {formatMs(latencyData[stage.key])}
            </span>
          </div>
        ))}
      </div>

      {/* Total / end-to-end with 1.5× emphasis */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-gray-400 uppercase tracking-wide">
          Total
        </span>
        <span className="text-xl font-bold text-white font-mono">
          {formatMs(latencyData.total)}
        </span>
      </div>
    </div>
  );
}
