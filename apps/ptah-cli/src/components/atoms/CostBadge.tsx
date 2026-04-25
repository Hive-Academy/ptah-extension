import React from 'react';

import { Badge } from './Badge.js';

export interface CostBadgeProps {
  cost: number;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function CostBadge({ cost }: CostBadgeProps): React.JSX.Element {
  return <Badge variant="success">{formatCost(cost)}</Badge>;
}

export default CostBadge;
