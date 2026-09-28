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
    let nextMeteorAt = performance.now() / 1000 + 7;
    let meteor: { start: number; x: number; y: number; travel: number; duration: number } | null = null;

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
        const alpha = star.brightness * (star.sparkle ? 0.16 + shimmer * 0.84 : 0.4 + shimmer * 0.6);
        const x = star.x * width;
        const y = star.y * height;
        context.globalAlpha = alpha;
        context.fillStyle = '#f4f7ff';
        context.fillRect(x - star.radius / 2, y - star.radius / 2, star.radius, star.radius);

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

      // One brief, low-contrast meteor at a time, spaced well apart. Its entire
      // path stays in the upper sky so it doesn't sweep across form controls.
      if (!motion.matches && !document.hidden) {
        if (!meteor && time >= nextMeteorAt) {
          meteor = {
            start: time, x: width * (0.05 + Math.random() * 0.55),
            y: height * (0.03 + Math.random() * 0.08),
            travel: Math.min(width * 0.3, height * 0.28, 300), duration: 1.4,
          };
          nextMeteorAt = time + 14 + Math.random() * 12;
        }
        if (meteor) {
          const progress = (time - meteor.start) / meteor.duration;
          if (progress >= 1) meteor = null;
          else {
            const x = meteor.x + progress * meteor.travel;
            const y = meteor.y + progress * meteor.travel * 0.4;
            const tail = Math.min(70, meteor.travel * 0.42);
            const trail = context.createLinearGradient(x - tail, y - tail * 0.4, x, y);
            trail.addColorStop(0, 'rgba(220,233,255,0)');
            trail.addColorStop(1, 'rgba(240,246,255,0.85)');
            context.globalAlpha = Math.sin(progress * Math.PI) * 0.55;
            context.strokeStyle = trail;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(x - tail, y - tail * 0.4);
            context.lineTo(x, y);
            context.stroke();
            context.drawImage(glow, x - 5, y - 5, 10, 10);
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
      stars = Array.from({ length: count }, () => {
        const depth = random();
        const near = depth > 0.95;
        const distant = depth < 0.7;
        return {
          x: random(), y: random(),
          radius: near ? 1.2 + random() * 0.5 : distant ? 0.4 + random() * 0.45 : 0.75 + random() * 0.5,
          phase: random() * Math.PI * 2,
          speed: distant ? 0.3 + random() * 0.6 : 0.65 + random() * 1.3,
          brightness: distant ? 0.2 + random() * 0.35 : 0.65 + random() * 0.35,
          sparkle: near,
        };
      });
      meteor = null;
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
      meteor = null;
      nextMeteorAt = performance.now() / 1000 + 7;
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
