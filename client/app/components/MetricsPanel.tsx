'use client';

import { LatencyData, DeploymentMode } from '../types';

interface MetricsPanelProps {
  latencyData: LatencyData;
  mode: DeploymentMode;
  isConnected: boolean;
}

function formatMs(value: number | null): string {
  return value !== null ? `${Math.round(value)}ms` : '—';
}

const modeLabels: Record<DeploymentMode, string> = {
  colocated: 'Colocated',
  distributed: 'Distributed',
  unknown: '—',
};

const modeColors: Record<DeploymentMode, string> = {
  colocated: 'text-emerald-400',
  distributed: 'text-blue-400',
  unknown: 'text-[var(--foreground)]/50',
};

/**
 * Compact metrics panel showing deployment mode and latency breakdown.
 * Sits at the bottom of the UI as a technical overlay for the demo.
 */
export default function MetricsPanel({ latencyData, mode, isConnected }: MetricsPanelProps) {
  if (!isConnected) return null;

  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-sm px-5 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Deployment mode */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--foreground)]/50 uppercase tracking-wide">Mode</span>
          <span className={`text-sm font-medium ${modeColors[mode]}`}>
            {modeLabels[mode]}
          </span>
        </div>

        {/* Latency stages */}
        <div className="flex items-center gap-4">
          {[
            { key: 'stt' as const, label: 'STT' },
            { key: 'llm' as const, label: 'LLM' },
            { key: 'tts' as const, label: 'TTS' },
          ].map((stage) => (
            <div key={stage.key} className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--foreground)]/50 uppercase">{stage.label}</span>
              <span className="text-sm font-mono text-[var(--foreground)]/80">
                {formatMs(latencyData[stage.key])}
              </span>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--foreground)]/50 uppercase tracking-wide">Total</span>
          <span className="text-sm font-bold font-mono text-[var(--accent-gold)]">
            {formatMs(latencyData.total)}
          </span>
        </div>
      </div>
    </div>
  );
}
