"use client";

import React, { useEffect, useRef } from "react";

export default function VideoBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Dynamic starry canvas fallback / supplement
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Generate star field
    const numStars = 180;
    const stars = Array.from({ length: numStars }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.8 + 0.2,
      speed: Math.random() * 0.02 + 0.005,
    }));

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Deep space gradient
      const grad = ctx.createRadialGradient(
        width / 2,
        height / 2,
        100,
        width / 2,
        height / 2,
        width
      );
      grad.addColorStop(0, "#090d1a");
      grad.addColorStop(1, "#04060a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Render stars with gentle twinkling
      stars.forEach((star) => {
        star.alpha += star.speed;
        if (star.alpha > 1 || star.alpha < 0.2) {
          star.speed = -star.speed;
        }
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(226, 232, 240, ${Math.abs(star.alpha)})`;
        ctx.shadowBlur = star.radius * 4;
        ctx.shadowColor = "rgba(56, 189, 248, 0.6)";
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0 overflow-hidden">
      {/* Starry deep-space canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* High-res orbital video background */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover opacity-25 mix-blend-screen transition-opacity duration-1000"
      >
        {/* Chandrayaan-2 / Lunar Orbital Animation Source */}
        <source
          src="https://assets.mixkit.co/videos/preview/mixkit-flying-over-the-surface-of-the-moon-41551-large.mp4"
          type="video/mp4"
        />
      </video>

      {/* Dark overlay gradient to guarantee glassmorphism UI readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-lunar-950 via-lunar-950/60 to-lunar-950/80" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-lunar-950/40 to-lunar-950/90" />
    </div>
  );
}
