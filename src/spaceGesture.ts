// A wheel gesture belongs to the surface that receives the listener.
// The sidebar passes here; the reading pane does not.
export function listenForSpaceGestures(
  target: EventTarget,
  switchBy: (direction: -1 | 1) => void,
): () => void {
  let horizontalDistance = 0;
  let verticalDistance = 0;
  let axis: "undecided" | "horizontal" | "vertical" = "undecided";
  let switched = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const reset = () => {
    horizontalDistance = 0;
    verticalDistance = 0;
    axis = "undecided";
    switched = false;
    idleTimer = undefined;
  };

  const onWheel = (event: Event) => {
    const wheel = event as WheelEvent;
    if (wheel.ctrlKey) return;

    const scale = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 120 : 1;
    const horizontal = wheel.deltaX * scale;
    const vertical = wheel.deltaY * scale;

    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(reset, 220);

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
    if (!switched) {
      if (Math.abs(horizontalDistance) > 72) {
        switched = true;
        switchBy(horizontalDistance > 0 ? 1 : -1);
      }
    }
  };

  target.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    target.removeEventListener("wheel", onWheel, true);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
  };
}
