/**
 * React-Query hooks over the marketplace read path (T1.7.1).
 *
 * Browse and the listing detail read through these hooks rather than touching
 * the transport, exactly as the ledger screens do (see {@link useLedger}): each
 * read is an authenticated {@link StationClient} call against the device's active
 * paired station, and the queries stay disabled — resolving to no data — while
 * the app is locked or no station is paired, so a screen can tell a "pair a
 * station" state from a spinner.
 *
 * Browse is an *infinite* query: the station pages ranked hits by `offset`, and
 * the screen appends pages as the member scrolls. The filter object is part of
 * the query key, so changing a tab, the search text, or a chip starts a fresh
 * ranked search from offset 0 rather than paging the previous one.
 */
import {useEffect, useState} from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {useCallback} from 'react';

import {useStationClient} from '../network/useStation';
import type {
  StationListingCard,
  StationListingDetail,
  StationSurface,
} from '../network/StationClient';

/** How many cards a browse page fetches. The station clamps anything larger. */
export const PAGE_SIZE = 20;

/** The browse filters a member has set — the full input to a ranked search. */
export interface MarketplaceFilters {
  /** Which surface's catalogue is showing (always one; the tabs pick it). */
  surface: StationSurface;
  /** The debounced free-text query, or empty for none. */
  text: string;
  /** A category tag, or `undefined` for any. */
  category?: string;
  /** A price ceiling in centi-Commons, or `undefined` for any. */
  maxPriceCenti?: number;
  /** A provider capped-composite floor, or `undefined` for any. */
  minProviderReputation?: number;
}

/** One browse page: the cards plus the offset they were read at. */
interface SearchPage {
  listings: StationListingCard[];
  offset: number;
}

/** Query keys, under a `marketplace` root so a refresh invalidates them together. */
export const marketplaceKeys = {
  root: ['marketplace'] as const,
  search: ['marketplace', 'search'] as const,
  listing: (id: string) => ['marketplace', 'listing', id] as const,
};

/**
 * A ranked, paged browse search (T1.7.1). Disabled when locked / unpaired; keyed
 * by the filters and the client's presence, so pairing (or any filter change)
 * refetches from the first page. Fetched fresh — a listing just created by the
 * CLI or another device should appear on the next browse without a stale window.
 */
export function useMarketplaceSearch(
  filters: MarketplaceFilters,
): UseInfiniteQueryResult<{pages: SearchPage[]}, Error> {
  const client = useStationClient();
  return useInfiniteQuery({
    queryKey: [...marketplaceKeys.search, filters, client !== null],
    enabled: client !== null,
    initialPageParam: 0,
    queryFn: async ({pageParam}): Promise<SearchPage> => {
      const {listings} = await client!.marketplaceSearch({
        surface: filters.surface,
        text: filters.text.trim().length > 0 ? filters.text.trim() : undefined,
        category: filters.category,
        max_price_centi: filters.maxPriceCenti,
        min_provider_reputation: filters.minProviderReputation,
        limit: PAGE_SIZE,
        offset: pageParam,
      });
      return {listings, offset: pageParam};
    },
    // A short page is the last page: the station returned fewer than a full
    // window, so there is nothing after it to ask for.
    getNextPageParam: last =>
      last.listings.length === PAGE_SIZE ? last.offset + PAGE_SIZE : undefined,
    staleTime: 0,
  });
}

/**
 * One listing in full (T1.7.1). Disabled when locked / unpaired. Fetched fresh:
 * a listing can go off offer between the browse read and the tap, and the detail
 * screen is the one place that must not present a stale "active".
 */
export function useListingDetail(
  listingId: string,
): UseQueryResult<StationListingDetail, Error> {
  const client = useStationClient();
  return useQuery({
    queryKey: [...marketplaceKeys.listing(listingId), client !== null],
    enabled: client !== null,
    queryFn: (): Promise<StationListingDetail> => client!.marketplaceListing(listingId),
    staleTime: 0,
  });
}

/** Refetches all marketplace reads — wired to browse's pull-to-refresh. */
export function useRefreshMarketplace(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({queryKey: marketplaceKeys.root});
  }, [queryClient]);
}

/**
 * A value that trails `input` by `delayMs`, so a search field fires one query
 * after typing settles rather than one per keystroke. The station search is a
 * network round trip per call; debouncing is what keeps a fast typist from
 * queuing a dozen ranked searches.
 */
export function useDebouncedValue<T>(input: T, delayMs: number): T {
  const [value, setValue] = useState(input);
  useEffect(() => {
    const timer = setTimeout(() => setValue(input), delayMs);
    return () => clearTimeout(timer);
  }, [input, delayMs]);
  return value;
}
