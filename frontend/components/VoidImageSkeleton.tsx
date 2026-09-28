"use client";

import { memo, useEffect, useRef } from "react";
import styles from "./VoidImageSkeleton.module.css";

const VoidImageSkeleton = memo(function VoidImageSkeleton() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = 0;
    let elapsed = 0;
    let visible = true;
    let pixels: { x: number; y: number; u: number; v: number; edge: number }[] = [];

    const draw = () => {
      context.fillStyle = "#101010";
      context.fillRect(0, 0, width, height);
      const time = elapsed * 0.00035;

      for (const pixel of pixels) {
        // Continuous waves illuminate a stationary grid without random flicker.
        const { x, y, u, v, edge } = pixel;
        const wave = Math.sin(u * 8 + v * 5 - time * 1.7 + Math.sin(v * 6 + time));
        const crossWave = Math.cos(v * 9 - u * 3 + time * 1.2);
        const crest = Math.pow(Math.max(0, (wave + crossWave + 2) / 4), 3);
        const ripple = (Math.sin(Math.hypot(u - 0.4, v - 0.55) * 19 - time * 2) + 1) / 2;
        const alpha = (0.09 + crest * 0.61 + ripple * 0.07) * edge;
        const shade = Math.round(16 + alpha * 219);
        const size = 1.15 + crest * 0.5;
        context.fillStyle = `rgb(${shade} ${shade} ${shade})`;
        context.fillRect(x - size / 2, y - size / 2, size, size);
      }
    };

    const tick = (now: number) => {
      if (now - lastTime >= 1000 / 30) {
        // Returning to a tab must not cause a jump in the animation.
        elapsed += lastTime ? Math.min(now - lastTime, 64) : 0;
        lastTime = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };

    const syncPlayback = () => {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (reducedMotion.matches) {
        elapsed = 4000;
        draw();
      } else if (visible && !document.hidden) {
        frame = requestAnimationFrame(tick);
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const spacing = width < 400 ? 10 : 12;
      const columns = Math.floor((width - 32) / spacing);
      const rows = Math.floor((height - 32) / spacing);
      const left = (width - (columns - 1) * spacing) / 2;
      const top = (height - (rows - 1) * spacing) / 2;
      pixels = [];
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = left + column * spacing;
          const y = top + row * spacing;
          const edge = Math.min(1, Math.min(x, width - x, y, height - y) / 48);
          pixels.push({ x, y, u: x / width, v: y / height, edge });
        }
      }
      draw();
    };

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncPlayback();
    });
    resize();
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    reducedMotion.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      reducedMotion.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, []);

  return (
    <span className={styles.frame} role="status" aria-label="Creating your image" aria-live="polite">
      <canvas ref={canvasRef} className={styles.pixels} aria-hidden="true" />
      <span className={styles.badge} aria-hidden="true">
        <span className={styles.activity}><i /><i /><i /></span>
        Creating
      </span>
    </span>
  );
});

export default VoidImageSkeleton;
