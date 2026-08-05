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
import {useWalletSession} from '../wallet/WalletSession';
import {
  createSignedListing,
  createSignedListingClose,
  type ListingDraft,
} from '../wallet/listing';
import {
  createSignedInquiryClose,
  createSignedInquiryMessage,
  createSignedInquiryOpened,
  type InquiryCloseOutcome,
} from '../wallet/inquiry';
import {
  createSignedContractTermination,
  createSignedServiceContract,
  type ContractTerminatedBy,
  type ContractTermsInput,
} from '../wallet/contract';
import {
  StationClientError,
  type StationContractDetail,
  type StationContractRow,
  type StationErrorKind,
  type StationInquiryThread,
  type StationListingCard,
  type StationListingDetail,
  type StationMyInquiryRow,
  type StationMyListingRow,
  type StationSurface,
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
  mine: ['marketplace', 'mine'] as const,
  listing: (id: string) => ['marketplace', 'listing', id] as const,
  inquiries: ['marketplace', 'inquiries'] as const,
  inquiry: (id: string) => ['marketplace', 'inquiry', id] as const,
  contracts: ['marketplace', 'contracts'] as const,
  contract: (id: string) => ['marketplace', 'contract', id] as const,
};

/** The outcome of a listing write. Never throws to the screen (mirrors the ledger's). */
export type ListingWriteResult<T = unknown> =
  | ({ok: true} & T)
  | {ok: false; error: StationErrorKind | 'locked'; message: string};

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

/**
 * The member's own listings (T1.7.2), in whatever state, newest first. Disabled
 * when locked / unpaired; keyed on the client's presence so pairing refetches.
 * Fetched fresh so a just-created or just-closed listing shows on the next open.
 */
export function useMyListings(): UseQueryResult<StationMyListingRow[], Error> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...marketplaceKeys.mine, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: async (): Promise<StationMyListingRow[]> => (await client!.myListings()).listings,
    staleTime: 0,
  });
}

/**
 * Returns a function that publishes a listing: it reads the station's community
 * from `whoami` (the listing is stamped with it, as a vouch is), signs the
 * listing on-device, transmits it, and refreshes the marketplace so it shows in
 * browse and My Listings. Online-only like a send — the community is signed into
 * the bytes, so it must be the station's authoritative value at publish time.
 */
export function useCreateListing(): (
  draft: ListingDraft,
) => Promise<ListingWriteResult<{listingId: string}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async draft => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const {community} = await client.whoami();
        if (community === undefined) {
          return {
            ok: false,
            error: 'rejected',
            message: 'Your station is too old to accept listings — update it first.',
          };
        }
        const createdAt = Math.floor(Date.now() / 1000);
        const signed = await createSignedListing(wallet, community, draft, createdAt);
        const {listingId} = await client.submitListing(signed.payloadBytes, signed.signature);
        await queryClient.invalidateQueries({queryKey: marketplaceKeys.root});
        return {ok: true, listingId: listingId.length > 0 ? listingId : signed.listingId};
      } catch (e) {
        return asListingWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that takes one of the member's own listings off offer: it
 * signs a `ProviderClosed` on-device, transmits it, and refreshes so the listing
 * drops out of browse and reads as closed in My Listings.
 */
export function useCloseListing(): (listingId: string) => Promise<ListingWriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async listingId => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const closedAt = Math.floor(Date.now() / 1000);
        const signed = await createSignedListingClose(wallet, listingId, closedAt);
        await client.submitListingClose(signed.payloadBytes, signed.signature);
        await queryClient.invalidateQueries({queryKey: marketplaceKeys.root});
        return {ok: true};
      } catch (e) {
        return asListingWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * One inquiry's full thread (T1.7.4). Disabled when locked / unpaired. Fetched
 * fresh and polled while the screen is open, so a reply from the other party
 * lands without the member pulling to refresh — an inquiry is a live conversation.
 */
export function useInquiryThread(
  inquiryId: string,
): UseQueryResult<StationInquiryThread, Error> {
  const client = useStationClient();
  return useQuery({
    queryKey: [...marketplaceKeys.inquiry(inquiryId), client !== null],
    enabled: client !== null,
    queryFn: (): Promise<StationInquiryThread> => client!.inquiryThread(inquiryId),
    staleTime: 0,
    refetchInterval: 5000,
  });
}

/**
 * The member's own inquiries (T1.7.4), as buyer or provider, newest activity
 * first. Disabled when locked / unpaired; keyed on the client's presence so
 * pairing refetches.
 */
export function useMyInquiries(): UseQueryResult<StationMyInquiryRow[], Error> {
  const client = useStationClient();
  return useQuery({
    queryKey: [...marketplaceKeys.inquiries, client !== null],
    enabled: client !== null,
    queryFn: async (): Promise<StationMyInquiryRow[]> => (await client!.myInquiries()).inquiries,
    staleTime: 0,
  });
}

/**
 * Returns a function that opens an inquiry against a listing: signs the opening
 * on-device, transmits it, and refreshes the inquiry lists. A requirements
 * refusal surfaces as a typed failure carrying the station's reason, so the
 * screen can say *why* rather than a generic error.
 */
export function useOpenInquiry(): (args: {
  listingId: string;
  message: string;
  offerCenti: number | null;
}) => Promise<ListingWriteResult<{inquiryId: string}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async ({listingId, message, offerCenti}) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const openedAt = Math.floor(Date.now() / 1000);
        const signed = await createSignedInquiryOpened(
          wallet,
          listingId,
          message,
          offerCenti,
          openedAt,
        );
        const {inquiryId} = await client.submitInquiry(signed.payloadBytes, signed.signature);
        await queryClient.invalidateQueries({queryKey: marketplaceKeys.inquiries});
        return {ok: true, inquiryId: inquiryId.length > 0 ? inquiryId : signed.inquiryId};
      } catch (e) {
        return asListingWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that sends a message (optionally a counter-offer) in an
 * inquiry, then refreshes that thread and the inbox.
 */
export function useSendInquiryMessage(): (args: {
  inquiryId: string;
  body: string;
  counterOfferCenti: number | null;
}) => Promise<ListingWriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async ({inquiryId, body, counterOfferCenti}) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const sentAt = Math.floor(Date.now() / 1000);
        const signed = await createSignedInquiryMessage(
          wallet,
          inquiryId,
          body,
          counterOfferCenti,
          sentAt,
        );
        await client.submitInquiryMessage(signed.payloadBytes, signed.signature);
        await refreshInquiry(queryClient, inquiryId);
        return {ok: true};
      } catch (e) {
        return asListingWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that closes an inquiry with `outcome` — accepting a price or
 * declining a side — then refreshes the thread and the inbox.
 */
export function useCloseInquiry(): (args: {
  inquiryId: string;
  outcome: InquiryCloseOutcome;
}) => Promise<ListingWriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async ({inquiryId, outcome}) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const closedAt = Math.floor(Date.now() / 1000);
        const signed = await createSignedInquiryClose(wallet, inquiryId, outcome, closedAt);
        await client.submitInquiryClose(signed.payloadBytes, signed.signature);
        await refreshInquiry(queryClient, inquiryId);
        return {ok: true};
      } catch (e) {
        return asListingWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/** Invalidates one inquiry's thread and the inbox together, after a write. */
async function refreshInquiry(
  queryClient: ReturnType<typeof useQueryClient>,
  inquiryId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({queryKey: marketplaceKeys.inquiry(inquiryId)}),
    queryClient.invalidateQueries({queryKey: marketplaceKeys.inquiries}),
  ]);
}

/**
 * One contract's full status (T1.7.7 Stage 2). Disabled when locked / unpaired.
 * Fetched fresh and polled while the screen is open, so the charge sweep's
 * progress — a period billed, a termination taking effect — lands without the
 * member pulling to refresh.
 */
export function useContractDetail(
  contractId: string,
): UseQueryResult<StationContractDetail, Error> {
  const client = useStationClient();
  return useQuery({
    queryKey: [...marketplaceKeys.contract(contractId), client !== null],
    enabled: client !== null,
    queryFn: (): Promise<StationContractDetail> => client!.marketplaceContractShow(contractId),
    staleTime: 0,
    refetchInterval: 5000,
  });
}

/**
 * The member's own contracts (T1.7.7 Stage 2), as buyer or provider, newest
 * first. Disabled when locked / unpaired; keyed on the client's presence so
 * pairing refetches.
 */
export function useMyContracts(): UseQueryResult<StationContractRow[], Error> {
  const client = useStationClient();
  return useQuery({
    queryKey: [...marketplaceKeys.contracts, client !== null],
    enabled: client !== null,
    queryFn: async (): Promise<StationContractRow[]> => (await client!.marketplaceContracts()).contracts,
    staleTime: 0,
  });
}

/**
 * Returns a function that signs up to a recurring service: it snapshots the terms
 * the caller derived from the agreed inquiry thread, signs the mandate on-device,
 * transmits it, and refreshes the contract lists. Online-only like a send — the
 * terms are signed into the bytes, so they must be the values the agreement
 * settled on. The station re-checks them, so a mismatch comes back as a typed
 * failure rather than a bad contract.
 */
export function useCreateContract(): (args: {
  inquiryId: string;
  listingId: string;
  providerAddress: string;
  terms: ContractTermsInput;
}) => Promise<ListingWriteResult<{contractId: string}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async ({inquiryId, listingId, providerAddress, terms}) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const startedAt = Math.floor(Date.now() / 1000);
        const signed = await createSignedServiceContract(wallet, {
          inquiryId,
          listingId,
          providerAddress,
          terms,
          startedAt,
        });
        const {contractId} = await client.submitContract(signed.payloadBytes, signed.signature);
        await queryClient.invalidateQueries({queryKey: marketplaceKeys.contracts});
        return {ok: true, contractId: contractId.length > 0 ? contractId : signed.contractId};
      } catch (e) {
        return asListingWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that ends a contract early — the member terminating from
 * their own side — then refreshes that contract and the list. The notice window
 * and any penalty are the station's charge sweep to apply.
 */
export function useTerminateContract(): (args: {
  contractId: string;
  terminatedBy: ContractTerminatedBy;
}) => Promise<ListingWriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async ({contractId, terminatedBy}) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const requestedAt = Math.floor(Date.now() / 1000);
        const signed = await createSignedContractTermination(
          wallet,
          contractId,
          terminatedBy,
          requestedAt,
        );
        await client.submitContractTermination(signed.payloadBytes, signed.signature);
        await refreshContract(queryClient, contractId);
        return {ok: true};
      } catch (e) {
        return asListingWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/** Invalidates one contract's detail and the list together, after a write. */
async function refreshContract(
  queryClient: ReturnType<typeof useQueryClient>,
  contractId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({queryKey: marketplaceKeys.contract(contractId)}),
    queryClient.invalidateQueries({queryKey: marketplaceKeys.contracts}),
  ]);
}

/** Normalises a thrown error into a typed {@link ListingWriteResult} failure. */
function asListingWriteError(e: unknown): {
  ok: false;
  error: StationErrorKind | 'locked';
  message: string;
} {
  if (e instanceof StationClientError) {
    return {ok: false, error: e.kind, message: e.message};
  }
  return {ok: false, error: 'malformed', message: e instanceof Error ? e.message : String(e)};
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
