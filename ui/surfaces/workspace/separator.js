/* [INPUT]: Separator, axis and value callbacks with optional CSS-coordinate scale.
 * [OUTPUT]: Element scale and shared pointer/keyboard resizing.
 * [POS]: Business-independent interaction. [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
export function elementScale(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: element.offsetWidth ? rect.width / element.offsetWidth : 1,
    y: element.offsetHeight ? rect.height / element.offsetHeight : 1,
  };
}

export function bindSeparator(handle, axis, read, change, save = () => {}) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.dataset.resizing = 'true';
    handle.setPointerCapture(event.pointerId);
    const direction = typeof axis === 'function' ? axis() : axis;
    const origin = direction === 'x' ? event.clientX : event.clientY;
    const value = read();
    const move = (event) =>
      change(
        value,
        ((direction === 'x' ? event.clientX : event.clientY) - origin) / (value.scale || 1),
      );
    const finish = () => {
      delete handle.dataset.resizing;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('lostpointercapture', finish);
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('lostpointercapture', finish);
  });
  handle.addEventListener('keydown', (event) => {
    const direction = typeof axis === 'function' ? axis() : axis;
    const delta = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[event.key];
    if (
      !delta ||
      (direction === 'x'
        ? !['ArrowLeft', 'ArrowRight'].includes(event.key)
        : !['ArrowUp', 'ArrowDown'].includes(event.key))
    )
      return;
    event.preventDefault();
    change(read(), delta);
    save();
  });
}
