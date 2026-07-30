import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * A click-to-open panel anchored to a trigger element.
 *
 * Uses FIXED positioning measured from the trigger's bounding rect, because the
 * table cells that need this clip their overflow — an absolutely positioned panel
 * would be sliced off by the column. The trade-off is that the position is a
 * one-off measurement, so the panel closes on scroll and resize rather than
 * drifting away from its trigger.
 *
 * Shared by the team overflow counter and truncated text cells so the
 * open/close/positioning behaviour is identical in both.
 *
 * @param {{width?: number, gap?: number}} options
 */
export function useAnchoredPopover({ width = 240, gap = 6 } = {}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);
  const popRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e) {
      if (!popRef.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        anchorRef.current?.focus();
      }
    }
    function onReflow() {
      setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    // Capture phase: the content region scrolls, not the window.
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.bottom + gap,
      // Clamp so the panel cannot hang off the right edge of the window.
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      width,
    });
    setOpen(true);
  }, [open, width, gap]);

  return { open, pos, anchorRef, popRef, toggle, close };
}
