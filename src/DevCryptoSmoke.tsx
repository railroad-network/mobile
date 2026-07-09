/**
 * Dev smoke screen (M1.1): proves the uniffi-generated React Native bindings
 * actually execute the Rust crypto on-device (ADR-0007's accepted-risk check).
 *
 * It generates a keypair, derives its `rrn1…` address, parses the address back,
 * checks validity of a good and a bad string, and hashes some bytes — all
 * through the real native module — and renders PASS/FAIL for each. If every row
 * is PASS, the RN → JSI → Rust path is working end to end.
 *
 * The native bindings are loaded lazily inside an effect and guarded, so this
 * component still renders (as "FFI unavailable") under Jest, where no native
 * module exists — keeping the existing App render test green without mocks.
 */
import {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

function runChecks(): Check[] {
  // Loaded here (not at module top) so importing this file under Jest does not
  // trigger the native install. The generated barrel installs the Rust crate.
  const ffi = require('./index');
  const {Keypair, PublicKey, Hash, isValidAddress} = ffi;

  const keypair = Keypair.generate();
  const address = keypair.publicKey().toAddress();
  const parsedBytes = PublicKey.fromAddress(address).toBytes();
  const originalBytes = keypair.publicKey().toBytes();
  const roundtrips =
    parsedBytes.length === originalBytes.length &&
    Array.from(originalBytes as Uint8Array).every(
      (b, i) => b === (parsedBytes as Uint8Array)[i],
    );
  const hashHex = Hash.of(new Uint8Array([1, 2, 3])).toHex();

  return [
    {
      label: 'Keypair.generate → rrn1 address',
      pass: typeof address === 'string' && address.startsWith('rrn1'),
      detail: address,
    },
    {
      label: 'address → publicKey round-trips to same bytes',
      pass: roundtrips,
      detail: `${originalBytes.length} bytes`,
    },
    {
      label: 'isValidAddress(real) is true',
      pass: isValidAddress(address) === true,
      detail: 'true',
    },
    {
      label: 'isValidAddress(garbage) is false',
      pass: isValidAddress('rrn1-not-an-address') === false,
      detail: 'false',
    },
    {
      label: 'Blake3 hash is 64 hex chars',
      pass: /^[0-9a-f]{64}$/.test(hashHex),
      detail: hashHex,
    },
  ];
}

export default function DevCryptoSmoke() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setChecks(runChecks());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const allPass = checks !== null && checks.every(c => c.pass);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rust FFI smoke test</Text>
      {error !== null && <Text style={styles.fail}>FFI unavailable: {error}</Text>}
      {checks?.map(c => (
        <View key={c.label} style={styles.row}>
          <Text style={c.pass ? styles.pass : styles.fail}>
            {c.pass ? '✓' : '✗'} {c.label}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {c.detail}
          </Text>
        </View>
      ))}
      {checks !== null && (
        <Text style={allPass ? styles.pass : styles.fail}>
          {allPass ? 'ALL PASS — RN → JSI → Rust works' : 'SOME CHECKS FAILED'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 20, justifyContent: 'center', gap: 12},
  title: {fontSize: 20, fontWeight: '600', marginBottom: 8},
  row: {gap: 2},
  detail: {fontSize: 11, opacity: 0.6, fontFamily: 'Courier'},
  pass: {color: '#137333', fontSize: 15},
  fail: {color: '#c5221f', fontSize: 15},
});
