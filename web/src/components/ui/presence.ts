import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The name tw-animate-css gives the keyframes every `animate-out` class runs. */
const EXIT = "exit";

/**
 * Keeps a layer mounted through its exit animation. While `open` it hands back `content` as given;
 * once closed it hands back the content it last showed open, so what animates away is what was on
 * screen and not the state its owner already fell back to. It unmounts when every `exit` animation
 * under `layer` has finished, or at once when none runs (an engine without `getAnimations`, a test).
 * Anything else animating inside, such as a spinner, is not waited for.
 */
export function usePresence<T>(open: boolean, content: T, layer: RefObject<HTMLElement | null>) {
  const [wasOpen, setWasOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setExiting(!open);
  }

  const shown = useRef(content);
  useLayoutEffect(() => {
    if (open) shown.current = content;
  });

  useEffect(() => {
    if (!exiting) return;
    const exits = (layer.current?.getAnimations?.({ subtree: true }) ?? [])
      .filter((animation) => (animation as CSSAnimation).animationName === EXIT);
    if (exits.length === 0) {
      setExiting(false);
      return;
    }
    let current = true;
    void Promise.allSettled(exits.map((animation) => animation.finished)).then(() => {
      if (current) setExiting(false);
    });
    return () => {
      current = false;
    };
  }, [exiting, layer]);

  return { mounted: open || exiting, closing: exiting, content: open ? content : shown.current };
}
