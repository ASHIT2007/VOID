"use client";

import { useEffect, useRef } from "react";

/** Gravitational particles confined to the existing slider track. */
export default function ThinkingEnergy({ level }: { level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  useEffect(() => { levelRef.current = level; }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, width = 180, height = 20, last = 0, time = 0;
    let gravity = levelRef.current / 2;
    let direction = 1;
    // Stable seeds preserve continuity when the direction reverses.
    const particles = Array.from({ length: 42 }, (_, i) => ({
      phase: (i * 0.61803398875) % 1, lane: Math.sin(i * 2.399963),
      speed: 0.8 + (i % 7) * 0.09, size: i % 5 === 0 ? 1.2 : 0.6,
    }));
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (now: number) => {
      if (document.hidden) return;
      frame = requestAnimationFrame(draw);
      if (last && now - last < 1000 / 30) return;
      const dt = Math.min(last ? (now - last) / 1000 : 0, 0.05);
      last = now;
      const target = levelRef.current / 2;
      const reverse = gravity > target + 0.005;
      direction += ((reverse ? -1 : 1) - direction) * (1 - Math.exp(-dt * 10));
      gravity = reduced.matches ? target : gravity + (target - gravity) * (1 - Math.exp(-dt * 8));
      if (!reduced.matches) time += dt;
      const center = height / 2, sink = center + gravity * (width - height);
      const ink = document.documentElement.classList.contains("dark") ? "255,255,255" : "65,65,65";
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.beginPath(); ctx.roundRect(0, 0, width, height, center); ctx.clip();
      const fill = ctx.createLinearGradient(0, 0, Math.max(sink, 1), 0);
      fill.addColorStop(0, `rgba(${ink},${0.025 + gravity ** 3 * 0.52})`);
      fill.addColorStop(0.75, `rgba(${ink},${0.02 + gravity ** 3 * 0.30})`);
      fill.addColorStop(1, `rgba(${ink},${0.05 + gravity ** 3 * 0.88})`);
      ctx.fillStyle = fill; ctx.fillRect(0, 0, sink, height);
      const point = (progress: number, lane: number, phase: number) => {
        const p = Math.max(0, Math.min(1, progress)), fall = p ** (1 + gravity * 1.5);
        const pull = Math.min(1, gravity * 2);
        return {
          x: (5 + p * (width - 10)) * (1 - pull) + (4 + fall * (sink - 4)) * pull,
          y: (center + lane * center * 0.63 + Math.sin(time + phase * 12) * 1.2) * (1 - pull)
            + (center + Math.sin(p * Math.PI * 4 + phase * 6) * lane * center * 0.85 * (1 - fall)) * pull,
        };
      };
      for (const particle of particles) {
        if (!reduced.matches) particle.phase = (particle.phase + dt * direction * (0.035 + gravity * 0.28) * particle.speed + 1) % 1;
        const travel = particle.phase;
        const p = travel;
        const head = point(p, particle.lane, particle.lane);
        const alpha = (0.4 + particle.size * 0.25) * Math.min(1, travel * 12, (1 - travel) * 12);
        if (gravity > 0.05) {
          ctx.beginPath();
          for (let step = 0; step <= 12; step++) {
            const tail = point(p - direction * (1 - step / 12) * (0.04 + gravity * 0.28), particle.lane, particle.lane);
            if (!step) ctx.moveTo(tail.x, tail.y); else ctx.lineTo(tail.x, tail.y);
          }
          ctx.strokeStyle = `rgba(${ink},${alpha * gravity * 0.48})`;
          ctx.lineWidth = 0.55; ctx.stroke();
        }
        ctx.fillStyle = `rgba(${ink},${alpha})`;
        ctx.beginPath(); ctx.arc(head.x, head.y, particle.size, 0, Math.PI * 2); ctx.fill();
        if (particle.size > 1) {
          ctx.strokeStyle = `rgba(${ink},${alpha * 0.65})`; ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(head.x - 2.4, head.y); ctx.lineTo(head.x + 2.4, head.y);
          ctx.moveTo(head.x, head.y - 2.4); ctx.lineTo(head.x, head.y + 2.4);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    const restart = () => { cancelAnimationFrame(frame); last = 0; draw(performance.now()); };
    const observer = new ResizeObserver(() => { resize(); restart(); });
    observer.observe(canvas); resize(); restart();
    document.addEventListener("visibilitychange", restart);
    reduced.addEventListener("change", restart);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener("visibilitychange", restart);
      reduced.removeEventListener("change", restart);
    };
  }, []);
  return <canvas ref={canvasRef} aria-hidden="true" className="thinking-energy pointer-events-none absolute inset-0 z-10 h-full w-full rounded-full" />;
}
