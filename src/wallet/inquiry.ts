/**
 * Building and signing inquiry records on-device (T1.7.4).
 *
 * An inquiry is the signed thread between a buyer and a provider — the step
 * between finding an offer and committing to it. As with {@link createSignedListing},
 * each record's canonical dCBOR is built here in TypeScript and signed by the
 * wallet, byte-identical to the station's `SignedPayload<T>` (`rrn-marketplace`
 * `inquiry.rs`), so a record signed on the phone verifies on the station and (for
 * an opening) content-addresses to the same `inquiry_id` (ADR-0002, ADR-0010).
 *
 * Three records, three signers: the buyer opens ({@link createSignedInquiryOpened}),
 * either party messages ({@link createSignedInquiryMessage}), and either party
 * closes it — agreeing a price or declining their side ({@link createSignedInquiryClose}).
 * The `Expired` outcome is the station's alone (a sweep signs it), so it has no
 * builder here.
 *
 * Offers and prices are integer centicommons, so they encode via {@link int}
 * directly — no float concern like a listing's reputation floor.
 *
 * Transmitting is `StationClient.submitInquiry` / `submitInquiryMessage` /
 * `submitInquiryClose`; the chat-thread screen is the rest of T1.7.4.
 */
import {bytes, canonicalBytes, int, map, nul, text, type CborValue} from '../crypto/cbor';
import {getRrnCryptoFfi} from '../crypto/ffi';
import {hexToBytes} from '../crypto/hex';
import type {Wallet} from './Wallet';

/** The log kind of an opening (mirrors `rrn_marketplace::inquiry::OPENED_KIND`). */
const OPENED_KIND = 'rrn.marketplace.inquiry_opened.v1';
/** The log kind of a message (mirrors `MESSAGE_KIND`). */
const MESSAGE_KIND = 'rrn.marketplace.inquiry_message.v1';
/** The log kind of a close (mirrors `CLOSED_KIND`). */
const CLOSED_KIND = 'rrn.marketplace.inquiry_closed.v1';

/** How a close ends the inquiry, on the buyer/provider side (never `Expired`). */
export type InquiryCloseOutcome =
  | {kind: 'agreed'; finalPriceCenti: number}
  | {kind: 'declined_by_buyer'}
  | {kind: 'declined_by_seller'};

/** A signed opening, ready to transmit to the paired station. */
export interface SignedInquiryOpened {
  /** Content address: hex of the Blake3 hash of the signed canonical bytes. */
  inquiryId: string;
  /** The listing being inquired about (hex content address). */
  listingId: string;
  /** The buyer's (this wallet's) bech32m `rrn1…` address. */
  buyerAddress: string;
  /** Unix seconds the inquiry was opened, from signed content. */
  openedAt: number;
  /** The canonical dCBOR bytes that were signed (what the station re-verifies). */
  payloadBytes: Uint8Array;
  /** The buyer's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/** A signed message or close — no id of its own; it references the inquiry. */
export interface SignedInquiryRecord {
  /** The inquiry this record belongs to (hex content address). */
  inquiryId: string;
  /** The canonical dCBOR bytes that were signed. */
  payloadBytes: Uint8Array;
  /** The signer's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

function requireInquiryId(inquiryId: string): Uint8Array {
  const idBytes = hexToBytes(inquiryId);
  if (idBytes.length !== 32) {
    throw new Error(`inquiry id must be 32 bytes, got ${idBytes.length}`);
  }
  return idBytes;
}

/**
 * Builds and signs an {@link SignedInquiryOpened} against `listingId` with
 * `wallet` as the buyer. Mirrors the station's `From<InquiryOpened> for CBOR`;
 * the `inquiry_id` is **not** part of the signed content — it is the Blake3 hash
 * of these bytes — so the map omits it, exactly as the Rust encoder does. Throws
 * if `listingId` is not 32 hex-encoded bytes.
 */
export async function createSignedInquiryOpened(
  wallet: Wallet,
  listingId: string,
  initialMessage: string,
  initialOfferCenti: number | null,
  openedAt: number,
): Promise<SignedInquiryOpened> {
  const listingBytes = hexToBytes(listingId);
  if (listingBytes.length !== 32) {
    throw new Error(`listing id must be 32 bytes, got ${listingBytes.length}`);
  }
  const payload: CborValue = map([
    ['kind', text(OPENED_KIND)],
    ['listing_id', bytes(listingBytes)],
    ['buyer', bytes(wallet.publicKey().toBytes())],
    ['initial_message', text(initialMessage)],
    ['initial_offer_centi', initialOfferCenti === null ? nul() : int(initialOfferCenti)],
    ['opened_at', int(openedAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const inquiryId = getRrnCryptoFfi().Hash.of(canonical).toHex();
  const signature = await wallet.sign(canonical);

  return {
    inquiryId,
    listingId,
    buyerAddress: wallet.address,
    openedAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/**
 * Builds and signs a message in `inquiryId`, optionally carrying a counter-offer.
 * Mirrors `From<InquiryMessage> for CBOR`. Throws if `inquiryId` is not 32 bytes.
 */
export async function createSignedInquiryMessage(
  wallet: Wallet,
  inquiryId: string,
  body: string,
  counterOfferCenti: number | null,
  sentAt: number,
): Promise<SignedInquiryRecord> {
  const idBytes = requireInquiryId(inquiryId);
  const payload: CborValue = map([
    ['kind', text(MESSAGE_KIND)],
    ['inquiry_id', bytes(idBytes)],
    ['sender', bytes(wallet.publicKey().toBytes())],
    ['body', text(body)],
    ['counter_offer_centi', counterOfferCenti === null ? nul() : int(counterOfferCenti)],
    ['sent_at', int(sentAt)],
  ]);
  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);
  return {inquiryId, payloadBytes: canonical, signature: signature.toBytes()};
}

/**
 * Builds and signs a close of `inquiryId` with `outcome`. Mirrors
 * `From<InquiryClosed> for CBOR`, including the nested `outcome` map. Throws if
 * `inquiryId` is not 32 bytes.
 */
export async function createSignedInquiryClose(
  wallet: Wallet,
  inquiryId: string,
  outcome: InquiryCloseOutcome,
  closedAt: number,
): Promise<SignedInquiryRecord> {
  const idBytes = requireInquiryId(inquiryId);
  const payload: CborValue = map([
    ['kind', text(CLOSED_KIND)],
    ['inquiry_id', bytes(idBytes)],
    ['outcome', outcomeCbor(outcome)],
    ['closed_at', int(closedAt)],
  ]);
  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);
  return {inquiryId, payloadBytes: canonical, signature: signature.toBytes()};
}

/** The nested `outcome` map, mirroring `From<InquiryOutcome> for CBOR`. */
function outcomeCbor(outcome: InquiryCloseOutcome): CborValue {
  switch (outcome.kind) {
    case 'agreed':
      return map([
        ['outcome', text('agreed')],
        ['final_price_centi', int(outcome.finalPriceCenti)],
      ]);
    case 'declined_by_buyer':
      return map([['outcome', text('declined_by_buyer')]]);
    case 'declined_by_seller':
      return map([['outcome', text('declined_by_seller')]]);
  }
}
