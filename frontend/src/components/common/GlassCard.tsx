import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'magenta' | 'slate' | 'none';
  onClick?: () => void;
  hover3dTilt?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  glowColor = 'cyan',
  onClick,
  hover3dTilt = true
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMousePos({ x, y });

    if (hover3dTilt) {
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotX = ((y - centerY) / centerY) * -4; // max -4deg
      const rotY = ((x - centerX) / centerX) * 4;  // max 4deg
      setRotateX(rotX);
      setRotateY(rotY);
    }
  };

  const handleMouseLeave = () => {
    setRotateX(0);
    setRotateY(0);
    setMousePos({ x: -100, y: -100 });
  };

  const getGlowBorderClass = () => {
    switch (glowColor) {
      case 'cyan':
        return 'border-cyan-500/20 hover:border-cyan-400/50 hover:shadow-[0_0_20px_rgba(0,242,254,0.15)]';
      case 'violet':
        return 'border-purple-500/20 hover:border-purple-400/50 hover:shadow-[0_0_20px_rgba(138,43,226,0.15)]';
      case 'emerald':
        return 'border-emerald-500/20 hover:border-emerald-400/50 hover:shadow-[0_0_20px_rgba(0,255,136,0.15)]';
      case 'amber':
        return 'border-amber-500/20 hover:border-amber-400/50 hover:shadow-[0_0_20px_rgba(255,170,0,0.15)]';
      case 'magenta':
        return 'border-fuchsia-500/20 hover:border-fuchsia-400/50 hover:shadow-[0_0_20px_rgba(255,0,127,0.15)]';
      default:
        return 'border-white/10 hover:border-white/20';
    }
  };

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        transformStyle: 'preserve-3d',
        perspective: '1000px',
        rotateX: `${rotateX}deg`,
        rotateY: `${rotateY}deg`
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`relative glass-panel backdrop-blur-md p-5 transition-all duration-200 cursor-pointer overflow-hidden ${getGlowBorderClass()} ${className}`}
    >
      {/* Radial Mouse Glow */}
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300 opacity-0 hover:opacity-100"
        style={{
          background: `radial-gradient(300px circle at ${mousePos.x}px ${mousePos.y}px, rgba(0,242,254,0.12), transparent 80%)`
        }}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
};
