"use client";

import { useEffect } from "react";

/** Keep matching [data-align-key] rows the same height across consensus columns. */
export function useConsensusRowAlign(
  enabled: boolean,
  rootSelector = "[data-consensus-align-root]",
  deps: unknown[] = [],
) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const root = document.querySelector(rootSelector);
    if (!root) return;

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nodes = Array.from(
          root.querySelectorAll<HTMLElement>("[data-align-key]"),
        );
        const groups = new Map<string, HTMLElement[]>();
        for (const el of nodes) {
          const key = el.getAttribute("data-align-key");
          if (!key || key === "metrics-skip") continue;
          const list = groups.get(key) ?? [];
          list.push(el);
          groups.set(key, list);
        }
        for (const els of groups.values()) {
          for (const el of els) el.style.minHeight = "";
        }
        for (const els of groups.values()) {
          if (els.length < 2) continue;
          const max = Math.max(
            ...els.map((el) => el.getBoundingClientRect().height),
          );
          for (const el of els) el.style.minHeight = `${Math.ceil(max)}px`;
        }
      });
    };

    const ro = new ResizeObserver(sync);
    const observeAll = () => {
      root.querySelectorAll("[data-align-key]").forEach((el) => ro.observe(el));
    };
    observeAll();
    sync();

    const mo = new MutationObserver(() => {
      observeAll();
      sync();
    });
    mo.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    window.addEventListener("resize", sync);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", sync);
      root.querySelectorAll<HTMLElement>("[data-align-key]").forEach((el) => {
        el.style.minHeight = "";
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rootSelector, ...deps]);
}
