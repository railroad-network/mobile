/**
 * The marketplace's controlled vocabulary, mirrored from the station (T1.7.1).
 *
 * The surface tags, category list, and reputation-band cutoffs are all the
 * station's — `rrn_marketplace::listing::CATEGORIES`, `Surface::tag`, and
 * ADR-0009's band thresholds. They are restated here rather than fetched because
 * they change only with a protocol version (a `.station-version` bump), and the
 * browse UI needs them synchronously to build its tabs and chips. This module is
 * the one place the mobile side names them, so a drift shows up in one file.
 */
import type {
  StationReputationBandName,
  StationSurface,
} from '../network/StationClient';

/** The three browse surfaces, in the order the tab bar shows them. */
export const SURFACES: {tag: StationSurface; label: string}[] = [
  {tag: 'goods', label: 'Goods'},
  {tag: 'services', label: 'Services'},
  {tag: 'commons', label: 'Commons'},
];

/**
 * The controlled category vocabulary (`rrn_marketplace::listing::CATEGORIES`).
 * Kept in the station's order; the filter prepends an "Any" that maps to no
 * `category` param.
 */
export const CATEGORIES = [
  'agriculture',
  'construction',
  'education',
  'food',
  'medical',
  'other',
  'tools',
  'transportation',
] as const;

/** A category tag for display: `food` → `Food`. */
export function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * A price ceiling the member can filter by, as `max_price_centi`. "Any" sends no
 * ceiling. Kept modest — the marketplace deals in Commons, not large sums — and
 * applied on every surface (a Commons ceiling still reads as "no dearer than").
 */
export interface PriceCeiling {
  key: string;
  label: string;
  /** The `max_price_centi` to send, or `undefined` for no ceiling. */
  maxPriceCenti?: number;
}

export const PRICE_CEILINGS: PriceCeiling[] = [
  {key: 'any', label: 'Any price'},
  {key: '5', label: '≤ 5', maxPriceCenti: 500},
  {key: '20', label: '≤ 20', maxPriceCenti: 2000},
  {key: '50', label: '≤ 50', maxPriceCenti: 5000},
];

/**
 * A provider-reputation floor the member can filter by, as
 * `min_provider_reputation` (a capped composite). The cutoffs are ADR-0009's
 * band minimums (`BAND_MEMBER_MIN` = 2.0, `BAND_TRUSTED_MIN` = 3.5). "Any" sends
 * no floor.
 */
export interface ReputationFloor {
  key: string;
  label: string;
  /** The `min_provider_reputation` to send, or `undefined` for no floor. */
  minComposite?: number;
}

export const REPUTATION_FLOORS: ReputationFloor[] = [
  {key: 'any', label: 'Any provider'},
  {key: 'member', label: 'Member +', minComposite: 2.0},
  {key: 'trusted', label: 'Trusted +', minComposite: 3.5},
];

/** The Badge variant a provider's band draws with — mirrors the Standing screen. */
export function bandVariant(
  band: StationReputationBandName,
): 'success' | 'accent' | 'neutral' {
  switch (band) {
    case 'Senior':
    case 'Trusted':
      return 'success';
    case 'Member':
      return 'accent';
    case 'New':
    default:
      return 'neutral';
  }
}
