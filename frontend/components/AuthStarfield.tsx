"use client";

import { useEffect, useRef } from 'react';
import styles from './AuthScreen.module.css';

export default function AuthStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastFrame = 0;
    let stars: { x: number; y: number; radius: number; phase: number; speed: number; brightness: number; sparkle: boolean }[] = [];

    // Soft light is drawn once, then reused for the brighter stars each frame.
    const glow = document.createElement('canvas');
    glow.width = glow.height = 64;
    const glowContext = glow.getContext('2d');
    if (glowContext) {
      const light = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
      light.addColorStop(0, 'rgba(255,255,255,1)');
      light.addColorStop(0.12, 'rgba(230,239,255,0.6)');
      light.addColorStop(0.4, 'rgba(184,207,255,0.12)');
      light.addColorStop(1, 'rgba(184,207,255,0)');
      glowContext.fillStyle = light;
      glowContext.fillRect(0, 0, 64, 64);
    }

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        const wave = (Math.sin(time * star.speed + star.phase) + 1) / 2;
        const shimmer = motion.matches ? 0.45 : wave ** 3;
        const alpha = star.brightness * (0.16 + shimmer * 0.84);
        const x = star.x * width;
        const y = star.y * height;
        context.globalAlpha = alpha;
        context.fillStyle = '#f4f7ff';
        context.fillRect(x, y, star.radius, star.radius);

        if (star.sparkle) {
          const size = 9 + shimmer * 19;
          context.globalAlpha = alpha * 0.8;
          context.drawImage(glow, x - size / 2, y - size / 2, size, size);
          // Thin diffraction rays emerge only at the peak, at independent times.
          const flare = motion.matches ? 0 : Math.max(0, (shimmer - 0.68) / 0.32);
          if (flare > 0) {
            const reach = 2 + flare * 6;
            context.globalAlpha = flare * star.brightness * 0.75;
            context.strokeStyle = '#e6edff';
            context.lineWidth = 0.55;
            context.beginPath();
            context.moveTo(x - reach, y);
            context.lineTo(x + reach, y);
            context.moveTo(x, y - reach);
            context.lineTo(x, y + reach);
            context.stroke();
          }
        }
      }
      context.globalAlpha = 1;
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      let seed = 72641;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const count = Math.min(1800, Math.max(550, Math.round(width * height / 850)));
      stars = Array.from({ length: count }, (_, index) => ({
        x: random(), y: random(), radius: 0.65 + random() * 1.1,
        phase: random() * Math.PI * 2, speed: 0.55 + random() * 1.6,
        brightness: 0.35 + random() * 0.65, sparkle: index % 23 === 0,
      }));
      draw(performance.now() / 1000);
    };

    const animate = (now: number) => {
      // Cap at 30 fps; no React updates or animation work in hidden tabs.
      if (now - lastFrame >= 1000 / 30) {
        draw(now / 1000);
        lastFrame = now;
      }
      frame = requestAnimationFrame(animate);
    };
    const syncAnimation = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!document.hidden && !motion.matches) frame = requestAnimationFrame(animate);
      else draw(performance.now() / 1000);
    };

    resize();
    syncAnimation();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', syncAnimation);
    motion.addEventListener('change', syncAnimation);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', syncAnimation);
      motion.removeEventListener('change', syncAnimation);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.starCanvas} aria-hidden="true" />;
}
