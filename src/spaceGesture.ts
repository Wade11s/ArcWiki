// A wheel gesture belongs to the surface that receives the listener.
// The sidebar passes here; the reading pane does not.
export function listenForSpaceGestures(
  target: EventTarget,
  switchBy: (direction: -1 | 1) => void,
): () => void {
  const gestureIdleMs = 220;
  const sameDirectionMomentumMs = 500;
  const switchDistance = 40;

  let horizontalDistance = 0;
  let verticalDistance = 0;
  let axis: "undecided" | "horizontal" | "vertical" = "undecided";
  let consumedDirection: -1 | 1 | undefined;
  let lastActivityAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const resetAccumulation = () => {
    horizontalDistance = 0;
    verticalDistance = 0;
    axis = "undecided";
  };

  const onWheel = (event: Event) => {
    const wheel = event as WheelEvent;
    if (wheel.ctrlKey) return;
    const now = Date.now();
    const idleFor = now - lastActivityAt;
    lastActivityAt = now;

    const scale = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 120 : 1;
    const horizontal = wheel.deltaX * scale;
    const vertical = wheel.deltaY * scale;

    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      resetAccumulation();
      idleTimer = undefined;
    }, gestureIdleMs);

    // Vertical reading always remains native, including immediately after a
    // consumed horizontal swipe with a little horizontal noise.
    if (Math.abs(vertical) > 14 && Math.abs(vertical) > Math.abs(horizontal) * 1.35) {
      resetAccumulation();
      axis = "vertical";
      return;
    }

    const horizontalDirection: -1 | 1 | undefined =
      horizontal > 0 ? 1 : horizontal < 0 ? -1 : undefined;
    if (consumedDirection !== undefined && horizontalDirection !== undefined) {
      const quietInterval = horizontalDirection === consumedDirection
        ? sameDirectionMomentumMs : gestureIdleMs;
      if (idleFor < quietInterval) {
        // Same-direction momentum needs a longer pause. An opposite sample
        // still needs an idle boundary: edge recoil is not another gesture.
        wheel.preventDefault();
        return;
      } else {
        consumedDirection = undefined;
        resetAccumulation();
      }
    }

    if (axis === "vertical") {
      // A clear new sideways motion can interrupt a vertical scroll's momentum.
      if (
        Math.abs(horizontal) <= 24 ||
        Math.abs(horizontal) <= Math.abs(vertical) * 1.8
      ) {
        return;
      }
      horizontalDistance = horizontal;
      verticalDistance = vertical;
      axis = "horizontal";
    } else {
      horizontalDistance += horizontal;
      verticalDistance += vertical;
      if (axis === "undecided") {
        if (
          Math.abs(verticalDistance) > 14 &&
          Math.abs(verticalDistance) > Math.abs(horizontalDistance) * 1.35
        ) {
          axis = "vertical";
          return;
        }
        if (
          Math.abs(horizontalDistance) < 10 ||
          Math.abs(horizontalDistance) <= Math.abs(verticalDistance) * 1.1
        ) {
          return;
        }
        axis = "horizontal";
      }
    }

    wheel.preventDefault();
    if (Math.abs(horizontalDistance) >= switchDistance) {
      consumedDirection = horizontalDistance > 0 ? 1 : -1;
      switchBy(consumedDirection);
    }
  };

  target.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    target.removeEventListener("wheel", onWheel, true);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
  };
}
