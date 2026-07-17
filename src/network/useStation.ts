/**
 * Hooks that bind the app to its paired station (T1.3.4).
 *
 * The ledger screens read through a {@link StationClient}, which needs two
 * things: the unlocked wallet (from the {@link WalletSession}) and the station
 * to talk to. This module supplies the second — the device's *active* paired
 * station — and assembles the client from both.
 *
 * "Active" is simply the first paired station today. M1 is one-account /
 * effectively one-station per device; when multiple-station support lands, this
 * is the single place that chooses which one the ledger reads from.
 */
import {useMemo} from 'react';
import {useQuery, type UseQueryResult} from '@tanstack/react-query';

import {useWalletSession} from '../wallet/WalletSession';
import {loadPairedStations, type PairedStation} from './pairedStation';
import {StationClient} from './StationClient';

/** Query keys for station-scoped data. */
export const stationKeys = {
  paired: ['stations', 'paired'] as const,
};

/** The paired stations, newest-first is not required (sorted by address). */
export function usePairedStations(): UseQueryResult<PairedStation[]> {
  return useQuery({queryKey: stationKeys.paired, queryFn: () => loadPairedStations()});
}

/**
 * The active paired station, or `null` if this device has paired with none. The
 * `isLoading` flag distinguishes "still checking" from "definitely none" so a
 * screen can tell a first-run empty state from a spinner.
 */
export function useActiveStation(): {station: PairedStation | null; isLoading: boolean} {
  const {data, isLoading} = usePairedStations();
  return {station: data && data.length > 0 ? data[0] : null, isLoading};
}

/**
 * A {@link StationClient} bound to the unlocked wallet and the active station, or
 * `null` when either is missing (locked, or no station paired). Memoized on the
 * wallet identity and station address so it is stable across renders.
 */
export function useStationClient(): StationClient | null {
  const {wallet} = useWalletSession();
  const {station} = useActiveStation();
  return useMemo(() => {
    if (wallet === null || station === null) {
      return null;
    }
    return new StationClient(wallet, station.address);
  }, [wallet, station]);
}
