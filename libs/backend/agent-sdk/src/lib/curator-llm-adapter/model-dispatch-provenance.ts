/**
 * Inert route handed to `SdkQueryRunner` with a one-shot.
 *
 * The caller does not read the active provider. An override names the
 * configured provider id. Ride-active is only a marker; the runner
 * derives the provider from the auth env it actually puts on the SDK
 * options, and only when a tap is registered.
 */
export interface ModelDispatchRoute {
  readonly component: 'memory-curator' | 'skill-lane';
  /** Curator query-lane name, or the skill lane id. */
  readonly laneId: string;
  readonly providerSource: 'override' | 'ride-active';
  /** Present when `providerSource` is `'override'`. */
  readonly overrideProviderId?: string;
}

/**
 * Provider and concrete model a product call dials. `resolvedModelId` is
 * the value written to the SDK options. `resolvedProviderId` is the
 * override id, or the provider of the auth env spread into those options.
 */
export interface ModelDispatchProvenance {
  readonly resolvedProviderId: string;
  readonly resolvedModelId: string;
  readonly component: 'memory-curator' | 'skill-lane';
  readonly laneId: string;
}

export interface ModelDispatchProvenanceTap {
  onModelDispatched(provenance: ModelDispatchProvenance): void | Promise<void>;
}

export const MODEL_DISPATCH_PROVENANCE_TAP = Symbol.for(
  'PtahModelDispatchProvenanceTap',
);
