import { useEffect, useState } from "react";
export function useStoredNumber(key: string, fallback: number, min: number, max: number) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      const n = saved === null ? fallback : Number(saved);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Preferences may be unavailable; current panel remains usable. */
    }
  }, [key, value]);
  return [value, (next: number) => setValue(Math.max(min, Math.min(max, next)))] as const;
}
export function useWorkspacePanels() {
  const [viewport, setViewport] = useState(window.innerWidth);
  const [agentOpen, setAgentOpen] = useState(() => window.innerWidth >= 1100);
  const [agentWidth, setAgentWidth] = useStoredNumber("mylo.agent.width", 360, 300, 520);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return {
    agentOpen,
    setAgentOpen,
    agentWidth,
    setAgentWidth,
    viewport,
    reservedWidth: agentOpen && viewport >= 1100 ? agentWidth : 0,
  };
}
