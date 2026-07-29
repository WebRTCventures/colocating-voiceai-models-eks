'use client';

import { ConnectionState } from '../types';

interface ConnectionControlsProps {
  state: ConnectionState;
  isMuted: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
}

export default function ConnectionControls({
  state,
  isMuted,
  onConnect,
  onDisconnect,
  onToggleMute,
}: ConnectionControlsProps) {
  const isConnecting = state === 'connecting';
  const isConnected = state === 'connected';
  const isReconnecting = state === 'reconnecting';

  const connectDisabled = isConnecting || isConnected || isReconnecting;
  const disconnectDisabled = !isConnected && !isReconnecting;
  const muteDisabled = !isConnected;

  return (
    <div className="flex items-center gap-3">
      {/* Connect Button */}
      <button
        onClick={onConnect}
        disabled={connectDisabled}
        aria-label="Connect to voice agent"
        className={`
          min-h-[40px] rounded-md px-5 py-2 text-sm font-medium transition-colors
          ${
            connectDisabled
              ? 'cursor-not-allowed bg-emerald-900/40 text-emerald-400/40'
              : 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700'
          }
        `}
      >
        {isConnecting ? 'Connecting…' : 'Connect'}
      </button>

      {/* Disconnect Button */}
      <button
        onClick={onDisconnect}
        disabled={disconnectDisabled}
        aria-label="Disconnect from voice agent"
        className={`
          min-h-[40px] rounded-md px-5 py-2 text-sm font-medium transition-colors
          ${
            disconnectDisabled
              ? 'cursor-not-allowed bg-red-900/40 text-red-400/40'
              : 'bg-red-600 text-white hover:bg-red-500 active:bg-red-700'
          }
        `}
      >
        Disconnect
      </button>

      {/* Mute/Unmute Toggle */}
      <button
        onClick={onToggleMute}
        disabled={muteDisabled}
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        className={`
          min-h-[40px] rounded-md px-5 py-2 text-sm font-medium transition-colors
          ${
            muteDisabled
              ? 'cursor-not-allowed bg-zinc-800/40 text-zinc-500/40'
              : isMuted
                ? 'bg-amber-600 text-white hover:bg-amber-500 active:bg-amber-700'
                : 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600 active:bg-zinc-800'
          }
        `}
      >
        {isMuted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  );
}
