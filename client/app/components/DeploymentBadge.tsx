'use client';

import { DeploymentMode } from '../types';

interface DeploymentBadgeProps {
  mode: DeploymentMode;
}

const badgeStyles: Record<DeploymentMode, string> = {
  colocated: 'bg-emerald-600 text-white',
  distributed: 'bg-blue-600 text-white',
  unknown: 'bg-neutral-600 text-neutral-200',
};

const badgeLabels: Record<DeploymentMode, string> = {
  colocated: 'Colocated',
  distributed: 'Distributed',
  unknown: 'Unknown',
};

export default function DeploymentBadge({ mode }: DeploymentBadgeProps) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${badgeStyles[mode]}`}
      aria-label={`Deployment mode: ${badgeLabels[mode]}`}
    >
      {badgeLabels[mode]}
    </span>
  );
}
