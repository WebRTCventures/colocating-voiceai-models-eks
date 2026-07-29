'use client';

import { ConnectionState } from '../types';

interface StatusBarProps {
  state: ConnectionState;
  error: string | null;
  agentPresent: boolean;
}

export default function StatusBar({ state, error, agentPresent }: StatusBarProps) {
  const getStatusText = (): string => {
    switch (state) {
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return agentPresent ? 'Connected' : 'Waiting for agent...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'disconnected':
      default:
        return 'Disconnected';
    }
  };

  const getStatusColor = (): string => {
    if (state === 'connected' && agentPresent) {
      return 'text-green-400';
    }
    if (state === 'connected' && !agentPresent) {
      return 'text-amber-400';
    }
    return 'text-gray-300';
  };

  return (
    <div className="flex items-center justify-between border-t border-zinc-700/50 bg-zinc-900/50 px-4 py-2">
      <span className={`text-sm font-medium ${getStatusColor()}`}>
        {getStatusText()}
      </span>
      {error && (
        <span className="text-sm text-red-400" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
