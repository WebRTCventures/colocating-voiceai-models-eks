'use client';

import { useEffect, useRef } from 'react';
import { TranscriptEntry } from '../hooks/useTranscript';

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  isConnected: boolean;
}

/**
 * Chat-style transcript panel showing the conversation between user and agent.
 * User messages align right, agent messages align left.
 * Auto-scrolls to the latest message.
 */
export default function TranscriptPanel({ entries, isConnected }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  if (!isConnected && entries.length === 0) return null;

  return (
    <div className="w-full flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-2">
        <svg className="w-4 h-4 text-[var(--accent-gold)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
        <span className="text-xs text-[var(--foreground)]/60 uppercase tracking-wide font-medium">
          Transcript
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="px-4 py-3 max-h-[200px] overflow-y-auto space-y-2 scrollbar-thin"
        role="log"
        aria-label="Call transcript"
        aria-live="polite"
      >
        {entries.length === 0 && isConnected && (
          <p className="text-xs text-[var(--foreground)]/40 text-center italic">
            Waiting for conversation…
          </p>
        )}

        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[80%] rounded-lg px-3 py-1.5 text-sm
                ${entry.speaker === 'agent'
                  ? 'bg-[var(--surface-raised)] text-[var(--foreground)] border border-[var(--border)]'
                  : 'bg-[var(--accent-gold)]/15 text-[var(--foreground)] border border-[var(--accent-gold)]/30'
                }
                ${!entry.isFinal ? 'opacity-60' : ''}
              `}
            >
              <span className="block text-[10px] uppercase tracking-wide mb-0.5 opacity-50">
                {entry.speaker === 'agent' ? '🍴 Golden Fork' : 'You'}
              </span>
              {entry.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
