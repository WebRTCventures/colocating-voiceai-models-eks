'use client';

import { ConnectionState } from '../types';

interface CallControlsProps {
  state: ConnectionState;
  isMuted: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
}

/**
 * Phone-call style controls: a large call button to start/end the call,
 * plus a mute toggle when connected.
 */
export default function CallControls({
  state,
  isMuted,
  onConnect,
  onDisconnect,
  onToggleMute,
}: CallControlsProps) {
  const isConnecting = state === 'connecting';
  const isConnected = state === 'connected';
  const isReconnecting = state === 'reconnecting';
  const inCall = isConnected || isReconnecting;

  return (
    <div className="flex items-center gap-4">
      {/* Mute button — only visible in-call */}
      {inCall && (
        <button
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`
            w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200
            ${isMuted
              ? 'bg-red-900/60 text-red-300 hover:bg-red-800/70'
              : 'bg-[var(--surface-raised)] text-[var(--foreground)] hover:bg-[var(--border)]'
            }
          `}
        >
          {isMuted ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 19L5 5m14 0v6a7 7 0 01-11.47 5.396M12 19.5v2m-3.75 0h7.5M5 10v1a7 7 0 001.53 4.396" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>
      )}

      {/* Main call button */}
      {!inCall ? (
        <button
          onClick={onConnect}
          disabled={isConnecting}
          aria-label="Call The Golden Fork"
          className={`
            w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200
            ${isConnecting
              ? 'bg-[var(--accent-gold-dim)] cursor-wait'
              : 'bg-[var(--accent-gold)] hover:bg-[var(--accent-gold-dim)] active:scale-95'
            }
            text-[var(--background)] shadow-lg shadow-[var(--accent-gold)]/20
          `}
        >
          {isConnecting ? (
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
          )}
        </button>
      ) : (
        <button
          onClick={onDisconnect}
          aria-label="End call"
          className="w-16 h-16 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-500 active:scale-95 transition-all duration-200 text-white shadow-lg shadow-red-600/20"
        >
          <svg className="w-7 h-7 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
          </svg>
        </button>
      )}
    </div>
  );
}
