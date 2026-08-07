"use client";

import { useEffect } from "react";

/**
 * Keep matching [data-align-key] rows the same height across consensus columns.
 * Avoids scroll jump by not observing attribute mutations (style writes) and
 * only updating minHeight when the value actually changes.
 */
export function useConsensusRowAlign(
  enabled: boolean,
  rootSelector = "[data-consensus-align-root]",
  deps: unknown[] = [],
) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ro: ResizeObserver | null = null;

    const sync = () => {
      if (cancelled) return;
      const root = document.querySelector(rootSelector);
      if (!root) return;

      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>("[data-align-key]"),
      );
      const groups = new Map<string, HTMLElement[]>();
      for (const el of nodes) {
        const key = el.getAttribute("data-align-key");
        if (!key) continue;
        const list = groups.get(key) ?? [];
        list.push(el);
        groups.set(key, list);
      }

      for (const els of groups.values()) {
        if (els.length < 2) continue;
        // Measure natural height without our previous minHeight
        const prev = els.map((el) => el.style.minHeight);
        for (const el of els) el.style.minHeight = "";
        const max = Math.ceil(
          Math.max(...els.map((el) => el.getBoundingClientRect().height)),
        );
        for (let i = 0; i < els.length; i++) {
          const next = `${max}px`;
          // Restore previous if measure failed oddly
          const target = Number.isFinite(max) && max > 0 ? next : prev[i];
          if (els[i].style.minHeight !== target) {
            els[i].style.minHeight = target;
          }
        }
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(sync);
      }, 80);
    };

    const root = document.querySelector(rootSelector);
    if (!root) return;

    ro = new ResizeObserver(schedule);
    root.querySelectorAll("[data-align-key]").forEach((el) => ro!.observe(el));

    // Only watch structural DOM changes — NOT attributes (minHeight writes).
    const mo = new MutationObserver((mutations) => {
      const structural = mutations.some(
        (m) => m.type === "childList" || m.type === "characterData",
      );
      if (!structural) return;
      root.querySelectorAll("[data-align-key]").forEach((el) => {
        try {
          ro?.observe(el);
        } catch {
          /* ignore */
        }
      });
      schedule();
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });

    schedule();
    window.addEventListener("resize", schedule);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(frame);
      ro?.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      document
        .querySelectorAll<HTMLElement>(`${rootSelector} [data-align-key]`)
        .forEach((el) => {
          el.style.minHeight = "";
        });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rootSelector, ...deps]);
}
