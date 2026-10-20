/**
 * Keeps the app shell sized to the visible viewport, so the composer and
 * shortcut bar sit directly on top of the on-screen keyboard. Android with
 * `interactive-widget=resizes-content` resizes the layout itself; iOS only
 * shrinks the visual viewport, which this tracks via CSS variables.
 */
export function trackVisualViewport(root: HTMLElement): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      root.style.setProperty('--vv-height', `${vv.height}px`);
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      const keyboard = window.innerHeight - vv.height > 120;
      root.classList.toggle('keyboard-open', keyboard);
    });
  };

  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  return () => {
    cancelAnimationFrame(frame);
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
