import { expect, test } from "bun:test";
import { listenForSpaceGestures } from "./spaceGesture";

function wheel(deltaX: number, deltaY = 0, deltaMode = 0, ctrlKey = false) {
  const event = new Event("wheel", { cancelable: true });
  Object.defineProperties(event, {
    deltaX: { value: deltaX },
    deltaY: { value: deltaY },
    deltaMode: { value: deltaMode },
    ctrlKey: { value: ctrlKey },
  });
  return event;
}

test("only sidebar horizontal gestures switch; vertical reading scroll stays native", async () => {
  const sidebar = new EventTarget();
  const content = new EventTarget();
  const directions: number[] = [];
  let wheelOptions: boolean | AddEventListenerOptions | undefined;
  const addEventListener = sidebar.addEventListener.bind(sidebar);
  sidebar.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "wheel") wheelOptions = options;
    addEventListener(type, listener, options);
  }) as typeof sidebar.addEventListener;
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    expect(wheelOptions).toEqual({ capture: true, passive: false });
    const contentWheel = wheel(150);
    expect(content.dispatchEvent(contentWheel)).toBe(true);
    expect(contentWheel.defaultPrevented).toBe(false);
    const verticalWheel = wheel(8, 90);
    expect(sidebar.dispatchEvent(verticalWheel)).toBe(true);
    expect(verticalWheel.defaultPrevented).toBe(false);
    const diagonalReadingWheel = wheel(90, 85);
    expect(sidebar.dispatchEvent(diagonalReadingWheel)).toBe(true);
    expect(diagonalReadingWheel.defaultPrevented).toBe(false);
    const ctrlWheel = wheel(150, 0, 0, true);
    expect(sidebar.dispatchEvent(ctrlWheel)).toBe(true);
    expect(ctrlWheel.defaultPrevented).toBe(false);
    expect(directions).toEqual([]);

    expect(sidebar.dispatchEvent(wheel(40))).toBe(false);
    expect(sidebar.dispatchEvent(wheel(40))).toBe(false);
    expect(directions).toEqual([1]);
    sidebar.dispatchEvent(wheel(150));
    expect(directions).toEqual([1]);

    await Bun.sleep(250);
    sidebar.dispatchEvent(wheel(-80));
    expect(directions).toEqual([1, -1]);
  } finally {
    stop();
  }
  sidebar.dispatchEvent(wheel(150));
  expect(directions).toEqual([1, -1]);
});

test("normalizes line-based horizontal wheels without changing vertical scrolling", () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    expect(sidebar.dispatchEvent(wheel(-5, 0, 1))).toBe(false);
    expect(directions).toEqual([-1]);
  } finally {
    stop();
  }
});

test("a diagonal sample does not erase the horizontal distance of one swipe", () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    sidebar.dispatchEvent(wheel(50));
    sidebar.dispatchEvent(wheel(5, 6));
    sidebar.dispatchEvent(wheel(30));
    expect(directions).toEqual([1]);
  } finally {
    stop();
  }
});

test("a short intentional horizontal swipe responds without requiring a long travel", () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    sidebar.dispatchEvent(wheel(18));
    sidebar.dispatchEvent(wheel(18));
    sidebar.dispatchEvent(wheel(12));
    expect(directions).toEqual([1]);
  } finally {
    stop();
  }
});

test("a delayed same-direction edge momentum tail cannot switch the Space twice", async () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    sidebar.dispatchEvent(wheel(-90));
    expect(directions).toEqual([-1]);
    await Bun.sleep(300);
    sidebar.dispatchEvent(wheel(-48));
    sidebar.dispatchEvent(wheel(-40));
    expect(directions).toEqual([-1]);
  } finally {
    stop();
  }
});

test("a same-direction swipe after a clear pause starts a new gesture", async () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    sidebar.dispatchEvent(wheel(90));
    await Bun.sleep(550);
    sidebar.dispatchEvent(wheel(18));
    sidebar.dispatchEvent(wheel(18));
    sidebar.dispatchEvent(wheel(12));
    expect(directions).toEqual([1, 1]);
  } finally {
    stop();
  }
});

test("one large horizontal delta only switches once for that swipe", () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    sidebar.dispatchEvent(wheel(-240));
    sidebar.dispatchEvent(wheel(-120));
    expect(directions).toEqual([-1]);
  } finally {
    stop();
  }
});

test("edge recoil cannot rearm a consumed swipe before a quiet interval", () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    sidebar.dispatchEvent(wheel(-80));
    sidebar.dispatchEvent(wheel(3));
    sidebar.dispatchEvent(wheel(-90));
    sidebar.dispatchEvent(wheel(80));
    expect(directions).toEqual([-1]);
  } finally {
    stop();
  }
});

test("a vertical scroll remains native immediately after a horizontal switch", () => {
  const sidebar = new EventTarget();
  const stop = listenForSpaceGestures(sidebar, () => {});
  try {
    sidebar.dispatchEvent(wheel(80));
    const reading = wheel(8, 90);
    expect(sidebar.dispatchEvent(reading)).toBe(true);
    expect(reading.defaultPrevented).toBe(false);
  } finally {
    stop();
  }
});

test("native vertical momentum does not introduce a false idle boundary before recoil", async () => {
  const sidebar = new EventTarget();
  const directions: number[] = [];
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    sidebar.dispatchEvent(wheel(80));
    for (let sample = 0; sample < 3; sample += 1) {
      await Bun.sleep(100);
      expect(sidebar.dispatchEvent(wheel(8, 90))).toBe(true);
    }
    await Bun.sleep(50);
    sidebar.dispatchEvent(wheel(-60));
    expect(directions).toEqual([1]);
  } finally {
    stop();
  }
});
