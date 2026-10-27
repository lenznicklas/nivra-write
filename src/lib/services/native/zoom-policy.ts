/** One application-level fallback for webviews and the browser preview.
 * No ordinary wheel, trackpad scrolling, or editor zoom changes are intercepted. */
export function installBrowserZoomPolicy(target: Window): () => void {
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };
  const gesture = (event: Event) => event.preventDefault();
  const key = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key))
      event.preventDefault();
  };
  target.addEventListener('wheel', wheel, { capture: true, passive: false });
  target.addEventListener('keydown', key, { capture: true });
  for (const name of ['gesturestart', 'gesturechange', 'gestureend'])
    target.addEventListener(name, gesture, { capture: true, passive: false });
  return () => {
    target.removeEventListener('wheel', wheel, true);
    target.removeEventListener('keydown', key, true);
    for (const name of ['gesturestart', 'gesturechange', 'gestureend'])
      target.removeEventListener(name, gesture, true);
  };
}
