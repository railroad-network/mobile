/**
 * Building and signing a marketplace listing on-device (T1.7.2).
 *
 * A listing is the member's standing, signed offer. As with {@link createSendProposal}
 * and {@link createSignedVouch}, the canonical dCBOR is built here in TypeScript
 * and signed by the wallet — byte-identical to the station's `SignedPayload<Listing>`
 * (`rrn-marketplace` `listing.rs`), so a listing signed on the phone verifies on
 * the station and content-addresses to the same `listing_id` (ADR-0002, ADR-0010).
 *
 * The `provider` is this wallet's own key (a listing's signer *is* its provider);
 * the `community` is the station's, read from `whoami` at publish time as a vouch
 * reads it. The `id` is **not** part of the signed content — it is the Blake3
 * hash of these bytes — so the map below omits it, exactly as `From<Listing> for
 * CBOR` does.
 *
 * # Reputation floors are whole numbers
 *
 * `requirements.min_reputation` is an `f32` on the wire, but the mobile encoder
 * forbids floats (signed payloads are integer-only — project policy). This is not
 * a limitation in practice: dCBOR's numeric reduction encodes a whole-number
 * `f32` (`0.0`, `1.0`, `2.0`) to the *same bytes* as the integer, so a whole-number
 * floor signed via {@link int} is byte-identical to the station's `f32`. The UI
 * only offers whole-number floors (a fractional one would throw here, at the
 * encoder). Fractional floors would need a dCBOR float encoder and are out of
 * scope until something needs them.
 *
 * Transmitting is `StationClient.submitListing` / `submitListingClose`; the create
 * form and My Listings screen are the rest of T1.7.2.
 */
import {bool, bytes, canonicalBytes, int, map, nul, text, type CborValue} from '../crypto/cbor';
import {getRrnCryptoFfi} from '../crypto/ffi';
import {hexToBytes} from '../crypto/hex';
import type {Wallet} from './Wallet';

/** The log kind of a listing (mirrors `rrn_marketplace::listing::LISTING_KIND`). */
const LISTING_KIND = 'rrn.marketplace.listing.v1';
/** The log kind of a close (mirrors `rrn_marketplace::lifecycle::CLOSED_KIND`). */
const CLOSED_KIND = 'rrn.marketplace.listing_closed.v1';

/** Which catalogue a listing sits in. */
export type ListingSurface = 'goods' | 'services' | 'commons';
/** What `amountCenti` is — a firm price or an opening ask. */
export type ListingPricingModel = 'fixed' | 'negotiable';
/** Whether a listing can be taken up right now. */
export type ListingAvailabilityStatus = 'available' | 'limited_stock' | 'unavailable';

/**
 * The provider-chosen contents of a listing — everything the member fills in.
 * `provider`, `community`, `id`, and `created_at` are supplied by
 * {@link createSignedListing}, not here: they are facts about who is publishing,
 * not choices the form makes.
 */
export interface ListingDraft {
  surface: ListingSurface;
  category: string;
  title: string;
  description: string;
  /** Signed centicommons. May be `<= 0` only on `commons` (a subsidy). */
  amountCenti: number;
  pricingModel: ListingPricingModel;
  /** Whether the provider invites offers (independent of the model). */
  negotiable: boolean;
  availabilityStatus: ListingAvailabilityStatus;
  /** Units available (Goods), or `null` for unlimited. */
  capacity: number | null;
  /** Next open slot, Unix seconds (Services), or `null`. */
  nextSlot: number | null;
  /**
   * Minimum capped composite an inquirer must hold — a **whole number** (see the
   * module note). `0` means no requirement.
   */
  minReputation: number;
  /** Whether the taker must belong to the listing's community. */
  communityMemberOnly: boolean;
  /** Claimed oracle tier, `1..=2` in Phase 1. */
  oracleTier: number;
  /** Unix seconds after which the station's sweep should close it, or `null`. */
  expiresAt: number | null;
}

/** A signed listing, ready to transmit to the paired station. */
export interface SignedListing {
  /** Content address: hex of the Blake3 hash of the signed canonical bytes. */
  listingId: string;
  /** The provider's (this wallet's) bech32m `rrn1…` address. */
  providerAddress: string;
  /** The community the listing was stamped into (from the station's whoami). */
  community: string;
  /** Unix seconds the listing was created, from signed content. */
  createdAt: number;
  /** The canonical dCBOR bytes that were signed (what the station re-verifies). */
  payloadBytes: Uint8Array;
  /** The provider's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/**
 * Builds and signs a {@link SignedListing} for `draft` with `wallet`, stamping
 * the provider (this wallet) and `community`. Throws if `minReputation` is not a
 * whole number (the encoder rejects the float).
 *
 * The field set, nesting, types, and byte-string `provider` must match the
 * station's `From<Listing> for CBOR` exactly, or the signature will not verify
 * and the recomputed `listing_id` will differ. Map key order is irrelevant —
 * dCBOR sorts canonically — but the nested maps and the explicit nulls must be
 * present.
 */
export async function createSignedListing(
  wallet: Wallet,
  community: string,
  draft: ListingDraft,
  createdAt: number,
): Promise<SignedListing> {
  const payload: CborValue = map([
    ['kind', text(LISTING_KIND)],
    ['provider', bytes(wallet.publicKey().toBytes())],
    ['community', text(community)],
    ['surface', text(draft.surface)],
    ['category', text(draft.category)],
    ['title', text(draft.title)],
    ['description', text(draft.description)],
    [
      'pricing',
      map([
        ['amount_centi', int(draft.amountCenti)],
        ['model', text(draft.pricingModel)],
        ['negotiable', bool(draft.negotiable)],
      ]),
    ],
    [
      'availability',
      map([
        ['status', text(draft.availabilityStatus)],
        ['capacity', draft.capacity === null ? nul() : int(draft.capacity)],
        ['next_slot', draft.nextSlot === null ? nul() : int(draft.nextSlot)],
      ]),
    ],
    [
      'requirements',
      map([
        // A whole-number f32 encodes as an integer under dCBOR reduction (module
        // note); `int` throws on a fractional value, which is the guard we want.
        ['min_reputation', int(draft.minReputation)],
        ['community_member_only', bool(draft.communityMemberOnly)],
        ['federation_only', bool(false)],
      ]),
    ],
    ['oracle_tier', int(draft.oracleTier)],
    ['federation_visible', bool(false)],
    ['created_at', int(createdAt)],
    ['expires_at', draft.expiresAt === null ? nul() : int(draft.expiresAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const listingId = getRrnCryptoFfi().Hash.of(canonical).toHex();
  const signature = await wallet.sign(canonical);

  return {
    listingId,
    providerAddress: wallet.address,
    community,
    createdAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/** A signed close, ready to transmit. */
export interface SignedListingClose {
  /** The listing being closed (hex content address). */
  listingId: string;
  /** Unix seconds the close happened, from this device's clock. */
  closedAt: number;
  /** The canonical dCBOR bytes that were signed. */
  payloadBytes: Uint8Array;
  /** The provider's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/**
 * Builds and signs a provider close of `listingId` (`ProviderClosed`, the only
 * reason a member may sign). Mirrors the station's `From<ListingClosed> for
 * CBOR`. Throws if `listingId` is not 32 hex-encoded bytes.
 */
export async function createSignedListingClose(
  wallet: Wallet,
  listingId: string,
  closedAt: number,
): Promise<SignedListingClose> {
  const idBytes = hexToBytes(listingId);
  if (idBytes.length !== 32) {
    throw new Error(`listing id must be 32 bytes, got ${idBytes.length}`);
  }
  const payload: CborValue = map([
    ['kind', text(CLOSED_KIND)],
    ['listing_id', bytes(idBytes)],
    ['reason', text('provider_closed')],
    ['closed_at', int(closedAt)],
  ]);
  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);
  return {
    listingId,
    closedAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}
