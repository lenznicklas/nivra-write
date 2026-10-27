// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { installBrowserZoomPolicy } from '../src/lib/services/native/zoom-policy';
it('blocks browser pinch, modified wheels and zoom keys without blocking ordinary scrolling', () => {
  const dispose = installBrowserZoomPolicy(window);
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    const event = new WheelEvent('wheel', { ...modifier, deltaY: 20, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  for (const [deltaX, deltaY] of [
    [0, 40],
    [40, 0],
    [15, 30],
  ]) {
    const event = new WheelEvent('wheel', { deltaX, deltaY, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    const event = new Event(name, { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  for (const key of ['+', '-', '=', '0']) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  const bold = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true });
  window.dispatchEvent(bold);
  expect(bold.defaultPrevented).toBe(false);
  dispose();
  const normal = new WheelEvent('wheel', { ctrlKey: true, cancelable: true });
  window.dispatchEvent(normal);
  expect(normal.defaultPrevented).toBe(false);
});
