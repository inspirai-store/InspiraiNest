import type { KeyboardEvent } from 'react';

export function scrollReader(event: KeyboardEvent<HTMLElement>, element: HTMLElement | null) {
  if (!element || event.target !== event.currentTarget) return;
  const amount = event.key === 'ArrowDown' ? 32 : event.key === 'ArrowUp' ? -32 : event.key === 'PageDown' ? element.clientHeight - 32 : event.key === 'PageUp' ? 32 - element.clientHeight : null;
  if (amount !== null) { event.preventDefault(); element.scrollTop += amount; }
  if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); element.scrollTop = event.key === 'Home' ? 0 : element.scrollHeight; }
}
