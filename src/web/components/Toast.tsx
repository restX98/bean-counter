import { useEffect, useRef } from "react";
import { Icon } from "./Icon.tsx";

/** How long a message stays, in milliseconds. */
const SHOWN_FOR = 8000;

/**
 * A short message at the bottom of the screen, with an optional Undo. It
 * goes away by itself; render it again with a new key to show another.
 */
export function Toast({
  text,
  onUndo,
  onDone,
}: {
  text: string;
  onUndo?: () => void;
  /** It's time for it to go. */
  onDone: () => void;
}) {
  // The latest onDone, so the timer runs once for each message.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const timer = setTimeout(() => done.current(), SHOWN_FOR);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="toast" role="status">
      <Icon name="check" />
      <span className="text">{text}</span>
      {onUndo && (
        <button type="button" className="toast-action" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}
