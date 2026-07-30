import { useState, useEffect, useRef } from 'react';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover.js';
import './TruncatedText.css';

/**
 * Table text that truncates, and reveals the full value when clicked.
 *
 * A `title` tooltip alone was not enough: it needs a mouse, so on touch and by
 * keyboard the hidden text was unreachable.
 *
 * The affordance only appears when the text is ACTUALLY clipped — measured, not
 * guessed from length — so short values stay plain text and the column does not
 * look full of buttons.
 */
export default function TruncatedText({ value, label = 'Full value' }) {
  const textRef = useRef(null);
  const [clipped, setClipped] = useState(false);
  const { open, pos, anchorRef, popRef, toggle } = useAnchoredPopover({ width: 260 });

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    // +1 absorbs sub-pixel rounding, which otherwise reports a 1px overflow on
    // text that visually fits.
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();

    // The column resizes with the window and with the sidebar collapsing, so
    // whether a value is clipped changes over time.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  if (!value) return <span className="cell-empty">—</span>;

  return (
    <>
      <span
        ref={(node) => {
          textRef.current = node;
          if (clipped) anchorRef.current = node;
        }}
        className={`trunc ${clipped ? 'is-clipped' : ''}`}
        onClick={clipped ? toggle : undefined}
        onKeyDown={
          clipped
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
        role={clipped ? 'button' : undefined}
        tabIndex={clipped ? 0 : undefined}
        aria-expanded={clipped ? open : undefined}
        title={clipped ? 'Click to see the full value' : undefined}
      >
        {value}
      </span>

      {open && pos && (
        <div
          ref={popRef}
          className="trunc-pop"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          role="dialog"
          aria-label={label}
        >
          <p className="trunc-pop-head">{label}</p>
          <p className="trunc-pop-body">{value}</p>
        </div>
      )}
    </>
  );
}
