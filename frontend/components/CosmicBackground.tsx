"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";

export default function CosmicBackground() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Generate random stars for the twinkling background
  const stars = useMemo(() => {
    if (!mounted) return [];
    return Array.from({ length: 250 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100, // percentage
      y: Math.random() * 100, // percentage
      size: Math.random() * 2 + 0.5, // 0.5px to 2.5px
      opacity: Math.random() * 0.7 + 0.3,
      duration: Math.random() * 2.0 + 1.0, // faster blinking: 1s to 3s
      delay: Math.random() * 5,
    }));
  }, [mounted]);

  // Generate a few random paths for shooting stars (Right to Left)
  const shootingStars = useMemo(() => {
    if (!mounted) return [];
    return Array.from({ length: 5 }).map((_, i) => {
      // Must travel from right to left
      const dTop = (Math.random() * 80) + 20; // always down slightly (20 to 100)
      const dLeft = -((Math.random() * 80) + 80); // always left (-80 to -160)
      
      // Calculate rotation angle.
      const angleRad = Math.atan2(dTop, dLeft);
      const angleDeg = (angleRad * 180) / Math.PI - 90;

      return {
        id: i,
        top: Math.random() * 50 - 20, // start upper half or above screen
        left: Math.random() * 50 + 70, // start far right (70% to 120%)
        dTop,
        dLeft,
        angleDeg,
        duration: Math.random() * 0.6 + 0.8, // fast: 0.8s to 1.4s
        delay: Math.random() * 8 + i * 4, 
        repeatDelay: Math.random() * 10 + 5, // more frequent
      };
    });
  }, [mounted]);

  // Generate glowing cosmic entities (Nebulas)
  const nebulas = useMemo(() => {
    if (!mounted) return [];
    return Array.from({ length: 4 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 300 + 200, // huge soft blobs
      color: ["#1e1b4b", "#312e81", "#1e3a8a", "#0f172a"][Math.floor(Math.random() * 4)],
      duration: Math.random() * 10 + 15, // very slow pulse
      delay: Math.random() * 5,
    }));
  }, [mounted]);

  return (
    <div className="absolute inset-0 bg-black overflow-hidden pointer-events-none">
      {/* Deep Space Gradient Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gray-900/40 via-black to-black"></div>

      {/* Twinkling Stars */}
      {stars.map((star) => (
        <motion.div
          key={`star-${star.id}`}
          className="absolute rounded-full bg-white"
          style={{
            top: `${star.y}%`,
            left: `${star.x}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: star.opacity,
          }}
          animate={{
            opacity: [0.1, star.opacity * 1.5, 0.1], // Deeper blinking contrast
            scale: [0.8, 1.3, 0.8],
          }}
          transition={{
            duration: star.duration,
            repeat: Infinity,
            delay: star.delay,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Shooting Stars */}
      {shootingStars.map((meteor) => (
        <motion.div
          key={`meteor-${meteor.id}`}
          className="absolute w-[2px] h-[60px] bg-gradient-to-b from-transparent via-white to-white rounded-full opacity-0"
          style={{
            top: `${meteor.top}%`,
            left: `${meteor.left}%`,
            transform: `rotate(${meteor.angleDeg}deg)`,
          }}
          animate={{
            opacity: [0, 1, 1, 0],
            top: [`${meteor.top}%`, `${meteor.top + meteor.dTop}%`],
            left: [`${meteor.left}%`, `${meteor.left + meteor.dLeft}%`],
          }}
          transition={{
            duration: meteor.duration,
            repeat: Infinity,
            repeatDelay: meteor.repeatDelay,
            delay: meteor.delay,
            ease: "linear",
            times: [0, 0.1, 0.8, 1],
          }}
        />
      ))}
      
      {/* Cosmic Entities / Nebulas */}
      {nebulas.map((nebula) => (
        <motion.div
          key={`nebula-${nebula.id}`}
          className="absolute rounded-full pointer-events-none blur-[100px]"
          style={{
            top: `${nebula.y}%`,
            left: `${nebula.x}%`,
            width: `${nebula.size}px`,
            height: `${nebula.size}px`,
            backgroundColor: nebula.color,
            transform: "translate(-50%, -50%)",
            opacity: 0.3,
          }}
          animate={{
            opacity: [0.2, 0.5, 0.2],
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: nebula.duration,
            repeat: Infinity,
            delay: nebula.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
