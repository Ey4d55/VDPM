/** Lazy entry point for the track twin, so three.js loads only when it is shown. */
import { lazy, Suspense, useEffect, useState } from "react";

const TrackTwinLazy = lazy(() => import("./TrackTwin"));

/** Width from which the twin sits in a rail beside the workspace. */
export const RAIL_QUERY = "(min-width: 1900px)";

export function useRail(): boolean {
  const get = () => {
    try {
      return window.matchMedia(RAIL_QUERY).matches;
    } catch {
      return false;
    }
  };
  const [wide, setWide] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(RAIL_QUERY);
    } catch {
      return;
    }
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function TrackTwin({ variant }: { variant: "rail" | "inline" }) {
  return (
    <Suspense fallback={<div className={`card twin twin--${variant} twin-loading`} aria-busy="true" />}>
      <TrackTwinLazy variant={variant} />
    </Suspense>
  );
}
