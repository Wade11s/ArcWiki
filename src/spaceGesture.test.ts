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
  const stop = listenForSpaceGestures(sidebar, (direction) => directions.push(direction));
  try {
    expect(content.dispatchEvent(wheel(150))).toBe(true);
    expect(sidebar.dispatchEvent(wheel(8, 90))).toBe(true);
    expect(sidebar.dispatchEvent(wheel(90, 85))).toBe(true);
    expect(sidebar.dispatchEvent(wheel(150, 0, 0, true))).toBe(true);
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
