/** Connectivity: NetInfo drives React Query's onlineManager (queries pause
 *  instead of erroring while offline — fetchStatus 'paused' distinguishes
 *  "offline" from "loading") and kicks an outbox replay on every reconnect. */
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { replayQueue } from './offline';

let started = false;

export function startConnectivity() {
  if (started) return;
  started = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => {
      // isInternetReachable is null until the first probe — treat null as online
      // so we don't stall queries while NetInfo is still checking.
      const online = Boolean(s.isConnected) && s.isInternetReachable !== false;
      setOnline(online);
      if (online) replayQueue().catch(() => {});
    }));
  // Cold start while online: flush anything left from a previous session.
  NetInfo.fetch().then((s) => {
    if (s.isConnected) replayQueue().catch(() => {});
  });
}

export { onlineManager };
