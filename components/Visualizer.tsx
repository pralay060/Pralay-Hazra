
import React, { useRef, useEffect } from 'react';

interface VisualizerProps {
  isSpeaking: boolean;
  isListening: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isSpeaking, isListening }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let particles: { x: number; y: number; size: number; speed: number; angle: number }[] = [];

    const initParticles = () => {
      particles = [];
      for (let i = 0; i < 40; i++) {
        particles.push({
          x: canvas.width / 2,
          y: canvas.height / 2,
          size: Math.random() * 3 + 1,
          speed: Math.random() * 2 + 0.5,
          angle: Math.random() * Math.PI * 2
        });
      }
    };

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || 300;
      canvas.height = canvas.parentElement?.clientHeight || 300;
      initParticles();
    };

    window.addEventListener('resize', resize);
    resize();

    const render = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = 80;
      const pulse = Math.sin(time / 500) * 5;
      const intensity = isSpeaking ? 15 : isListening ? 8 : 2;

      // Draw Main Orb Glow
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius + pulse + intensity * 2);
      if (isSpeaking) {
        gradient.addColorStop(0, 'rgba(147, 51, 234, 0.4)');
        gradient.addColorStop(1, 'rgba(147, 51, 234, 0)');
      } else if (isListening) {
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
      } else {
        gradient.addColorStop(0, 'rgba(107, 114, 128, 0.2)');
        gradient.addColorStop(1, 'rgba(107, 114, 128, 0)');
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + 40, 0, Math.PI * 2);
      ctx.fill();

      // Draw Wave Rings
      for (let i = 0; i < 3; i++) {
        const ringRadius = baseRadius + (time / 10 + i * 40) % 60;
        const alpha = 1 - ((ringRadius - baseRadius) / 60);
        ctx.strokeStyle = isSpeaking 
          ? `rgba(168, 85, 247, ${alpha * 0.5})` 
          : isListening 
            ? `rgba(59, 130, 246, ${alpha * 0.5})` 
            : `rgba(156, 163, 175, ${alpha * 0.2})`;
        
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw core
      ctx.fillStyle = isSpeaking ? '#a855f7' : isListening ? '#3b82f6' : '#4b5563';
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius - 10 + pulse, 0, Math.PI * 2);
      ctx.fill();

      // Particles for interaction
      if (isSpeaking || isListening) {
        particles.forEach(p => {
          p.x += Math.cos(p.angle) * p.speed * (intensity / 2);
          p.y += Math.sin(p.angle) * p.speed * (intensity / 2);
          
          const dist = Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2));
          if (dist > 150) {
            p.x = centerX;
            p.y = centerY;
          }

          ctx.fillStyle = isSpeaking ? `rgba(192, 132, 252, ${1 - dist/150})` : `rgba(96, 165, 250, ${1 - dist/150})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [isSpeaking, isListening]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
};

export default Visualizer;
