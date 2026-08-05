/**
 * Building and signing service-contract records on-device (T1.7.7 Stage 2).
 *
 * A service contract is a buyer's standing mandate over an agreed inquiry: the
 * one signature that pre-authorizes every period's charge on a recurring service.
 * As with {@link createSignedInquiryOpened}, each record's canonical dCBOR is
 * built here in TypeScript and signed by the wallet, byte-identical to the
 * station's `SignedPayload<T>` (`rrn-marketplace` `contract.rs`), so a record
 * signed on the phone verifies on the station and — for a contract — content-
 * addresses to the same `contract_id` (ADR-0002, ADR-0010).
 *
 * Two records, two signers: the buyer signs the {@link ServiceContract}
 * ({@link createSignedServiceContract}); either party signs a termination
 * ({@link createSignedContractTermination}). The provider's *acceptance* is not a
 * record here — it is the `InquiryClosed{Agreed}` they already signed to grant the
 * inquiry (T1.7.4), which the contract cites. `ContractCharge` (the per-period
 * balance move) is the station's alone, so it has no builder here.
 *
 * The buyer snapshots the terms from the agreed inquiry thread: its
 * `final_price_centi` is the per-period charge, and the listing's `recurring`
 * block (now carried on the thread view) is the cadence. The station re-checks all
 * of it on append, so a wrong snapshot is refused rather than trusted.
 *
 * Prices and periods are integers, so they encode via {@link int} directly — no
 * float concern like a listing's reputation floor.
 *
 * Transmitting is `StationClient.submitContract` / `submitContractTermination`;
 * the contract screens are the rest of Stage 2.
 */
import {bytes, canonicalBytes, int, map, text, type CborValue} from '../crypto/cbor';
import {parseAddress} from '../crypto/address';
import {getRrnCryptoFfi} from '../crypto/ffi';
import {hexToBytes} from '../crypto/hex';
import type {Wallet} from './Wallet';

/** The log kind of a contract (mirrors `rrn_marketplace::contract::CONTRACT_KIND`). */
const CONTRACT_KIND = 'rrn.marketplace.service_contract.v1';
/** The log kind of a termination (mirrors `TERMINATION_KIND`). */
const TERMINATION_KIND = 'rrn.marketplace.contract_termination.v1';

/** How often a period falls due — the listing's declared cadence. */
export type Frequency =
  | {unit: 'daily'}
  | {unit: 'weekly'}
  | {unit: 'monthly'}
  | {unit: 'custom'; secs: number};

/** The standing terms a contract commits to, snapshotted from listing + agreement. */
export interface ContractTermsInput {
  /** The cadence a period falls on. */
  frequency: Frequency;
  /** How many periods the commitment runs for. */
  durationPeriods: number;
  /** The per-period charge in centicommons (the agreed inquiry's final price). */
  commonsPerPeriodCenti: number;
  /** The buyer's free-form notes; keys are sorted to match the station's `BTreeMap`. */
  performanceMetrics: Record<string, string>;
  /** Days of notice either side must give to end it early. */
  noticePeriodDays: number;
  /** The penalty in centicommons on whoever ends it before its natural end. */
  earlyTerminationPenaltyCenti: number;
}

/** Which party is ending a contract. */
export type ContractTerminatedBy = 'buyer' | 'provider';

/** A signed contract, ready to transmit to the paired station. */
export interface SignedServiceContract {
  /** Content address: hex of the Blake3 hash of the signed canonical bytes. */
  contractId: string;
  /** The agreed inquiry this contract is born from (hex content address). */
  inquiryId: string;
  /** The listing subscribed to (hex content address). */
  listingId: string;
  /** The buyer's (this wallet's) bech32m `rrn1…` address. */
  buyerAddress: string;
  /** The provider's bech32m `rrn1…` address. */
  providerAddress: string;
  /** The canonical dCBOR bytes that were signed (what the station re-verifies). */
  payloadBytes: Uint8Array;
  /** The buyer's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/** A signed termination — no id of its own; it references the contract. */
export interface SignedContractTermination {
  /** The contract this termination ends (hex content address). */
  contractId: string;
  /** The canonical dCBOR bytes that were signed. */
  payloadBytes: Uint8Array;
  /** The signer's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

function require32(hex: string, what: string): Uint8Array {
  const idBytes = hexToBytes(hex);
  if (idBytes.length !== 32) {
    throw new Error(`${what} must be 32 bytes, got ${idBytes.length}`);
  }
  return idBytes;
}

/** The nested `frequency` map, mirroring `From<Frequency> for CBOR`. */
function frequencyCbor(f: Frequency): CborValue {
  if (f.unit === 'custom') {
    // Rust inserts `unit` then `secs`; production canonicalization reorders, but
    // this order keeps the built tree identical to the station's fixture vectors.
    return map([
      ['unit', text('custom')],
      ['secs', int(f.secs)],
    ]);
  }
  return map([['unit', text(f.unit)]]);
}

/** The nested `terms` map, mirroring `From<ContractTerms> for CBOR`. */
function termsCbor(terms: ContractTermsInput): CborValue {
  // The station stores metrics in a `BTreeMap`, which iterates in sorted key
  // order; sort here so the built tree matches byte-for-byte.
  const metricEntries: Array<[string, CborValue]> = Object.keys(terms.performanceMetrics)
    .sort()
    .map(key => [key, text(terms.performanceMetrics[key])]);
  return map([
    ['frequency', frequencyCbor(terms.frequency)],
    ['duration_periods', int(terms.durationPeriods)],
    ['commons_per_period_centi', int(terms.commonsPerPeriodCenti)],
    ['performance_metrics', map(metricEntries)],
    ['notice_period_days', int(terms.noticePeriodDays)],
    ['early_termination_penalty_centi', int(terms.earlyTerminationPenaltyCenti)],
  ]);
}

/**
 * Builds and signs a {@link SignedServiceContract} with `wallet` as the buyer.
 * Mirrors the station's `From<ServiceContract> for CBOR`; the `contract_id` is
 * **not** part of the signed content — it is the Blake3 hash of these bytes — so
 * the map omits it, exactly as the Rust encoder does. Throws if `inquiryId` or
 * `listingId` is not 32 hex-encoded bytes, or `providerAddress` is not a valid
 * `rrn1…` address.
 */
export async function createSignedServiceContract(
  wallet: Wallet,
  params: {
    inquiryId: string;
    listingId: string;
    providerAddress: string;
    terms: ContractTermsInput;
    startedAt: number;
  },
): Promise<SignedServiceContract> {
  const inquiryBytes = require32(params.inquiryId, 'inquiry id');
  const listingBytes = require32(params.listingId, 'listing id');
  const providerPk = parseAddress(params.providerAddress);
  if ('error' in providerPk) {
    throw new Error(`provider is not a valid address: ${params.providerAddress}`);
  }

  const payload: CborValue = map([
    ['kind', text(CONTRACT_KIND)],
    ['inquiry_id', bytes(inquiryBytes)],
    ['listing_id', bytes(listingBytes)],
    ['buyer', bytes(wallet.publicKey().toBytes())],
    ['provider', bytes(providerPk.toBytes())],
    ['terms', termsCbor(params.terms)],
    ['started_at', int(params.startedAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const contractId = getRrnCryptoFfi().Hash.of(canonical).toHex();
  const signature = await wallet.sign(canonical);

  return {
    contractId,
    inquiryId: params.inquiryId,
    listingId: params.listingId,
    buyerAddress: wallet.address,
    providerAddress: params.providerAddress,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/**
 * Builds and signs a termination of `contractId` by `terminatedBy` (which must be
 * this wallet's role on the contract). Mirrors `From<ContractTermination> for
 * CBOR`. Throws if `contractId` is not 32 bytes.
 */
export async function createSignedContractTermination(
  wallet: Wallet,
  contractId: string,
  terminatedBy: ContractTerminatedBy,
  requestedAt: number,
): Promise<SignedContractTermination> {
  const idBytes = require32(contractId, 'contract id');
  const payload: CborValue = map([
    ['kind', text(TERMINATION_KIND)],
    ['contract_id', bytes(idBytes)],
    ['terminated_by', text(terminatedBy)],
    ['requested_at', int(requestedAt)],
  ]);
  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);
  return {contractId, payloadBytes: canonical, signature: signature.toBytes()};
}
