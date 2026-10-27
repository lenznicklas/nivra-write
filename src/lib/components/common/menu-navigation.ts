// Used by application and contextual menus; focus returns to the invoking control.
export function menuNavigation(element: HTMLElement, onclose: () => void) {
  const previous = document.activeElement as HTMLElement | null;
  const items = () =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  queueMicrotask(() => items()[0]?.focus());
  function keydown(event: KeyboardEvent) {
    const buttons = items();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
      return;
    }
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      buttons[next]?.focus();
    }
    if (event.key === 'Tab') onclose();
  }
  element.addEventListener('keydown', keydown);
  return {
    destroy() {
      element.removeEventListener('keydown', keydown);
      if (document.activeElement === document.body || element.contains(document.activeElement))
        previous?.focus();
    },
  };
}
