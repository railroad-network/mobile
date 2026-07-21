/**
 * Wires the subscribe long-poll (T1.3.5) into the app's lifecycle.
 *
 * Runs {@link runSubscription} for the active paired station whenever the wallet
 * is unlocked (so a {@link StationClient} exists) and a station is paired, and
 * tears it down otherwise. The event handler is deliberately minimal for M1.3:
 * any event may change the balance or the transaction view, so it invalidates the
 * ledger queries and lets Home/History refetch through their normal read path.
 * Local/background notifications are T1.3.6.
 *
 * The loop is gated implicitly on the foreground: {@link WalletSession} drops the
 * unlocked wallet when the app backgrounds, which nulls the client here and
 * aborts the poll. Mount {@link StationSubscription} once, high in the tree.
 */
import {useEffect} from 'react';
import {useQueryClient} from '@tanstack/react-query';

import {ledgerKeys} from '../ledger/useLedger';
import {runSubscription} from './stationSubscription';
import {useActiveStation, useStationClient} from './useStation';

/**
 * Starts/stops the subscribe loop as the unlocked wallet and active station come
 * and go. Returns nothing — it is a side-effect hook.
 */
export function useStationSubscription(): void {
  const client = useStationClient();
  const {station} = useActiveStation();
  const queryClient = useQueryClient();
  const address = station?.address ?? null;

  useEffect(() => {
    if (client === null || address === null) {
      return;
    }
    const controller = new AbortController();
    runSubscription(client, address, {
      signal: controller.signal,
      onEvent: () => {
        // Refetch balance + activity; the read path renders the change.
        queryClient.invalidateQueries({queryKey: ledgerKeys.root}).catch(() => {});
      },
    }).catch(() => {});
    return () => controller.abort();
  }, [client, address, queryClient]);
}

/** A render-nothing component that runs {@link useStationSubscription}. */
export function StationSubscription(): null {
  useStationSubscription();
  return null;
}
