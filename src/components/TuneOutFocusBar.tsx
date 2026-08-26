import React, { useState, useRef } from "react";
import { Bed, Moon, User, Sparkles, BookOpen, Brain, CheckCircle2 } from "lucide-react";

export interface TuneOutMode {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  color?: "amber" | "blue" | "emerald";
}

export const DEFAULT_TUNEOUT_MODES: TuneOutMode[] = [
  {
    id: "quick-study",
    label: "Quick Review",
    icon: Bed,
    description: "Rapid memory revision and high-yield key facts",
    color: "blue",
  },
  {
    id: "deep-notes",
    label: "Deep Study",
    icon: Moon,
    description: "Comprehensive multi-page chapters and concept breakdowns",
    color: "blue",
  },
  {
    id: "exam-sprint",
    label: "Exam Sprint",
    icon: User,
    description: "Intense question generation and active recall testing",
    color: "amber",
  },
];

interface TuneOutFocusBarProps {
  modes?: TuneOutMode[];
  activeModeId?: string;
  onModeChange?: (modeId: string) => void;
  className?: string;
  title?: string;
  show3DTilt?: boolean;
}

/**
 * 🌟 Reijo "Tune Out" 3D Liquid Glassmorphism Focus Capsule Bar
 * Faithful recreation of the viral Dribbble design by Reijo:
 * - Ultra-refractive curved glass base plate
 * - 3D tactile jelly capsule pills with specular bevel highlights
 * - Glowing liquid amber / sapphire active state
 * - Smooth 3D perspective tilt on mouse interaction
 */
export function TuneOutFocusBar({
  modes = DEFAULT_TUNEOUT_MODES,
  activeModeId,
  onModeChange,
  className = "",
  title,
  show3DTilt = true,
}: TuneOutFocusBarProps) {
  const [selectedId, setSelectedId] = useState<string>(activeModeId || modes[2]?.id || modes[0]?.id);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentId = activeModeId !== undefined ? activeModeId : selectedId;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!show3DTilt || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    // Mild, luxurious 3D tilt
    const tiltX = -(y / rect.height) * 8;
    const tiltY = (x / rect.width) * 8;
    setTilt({ x: tiltX, y: tiltY });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTilt({ x: 0, y: 0 });
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    onModeChange?.(id);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      className={`relative inline-block transition-transform duration-300 ease-out ${className}`}
      style={{
        perspective: "1000px",
        transform: isHovered
          ? `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateY(-2px)`
          : "rotateX(0deg) rotateY(0deg) translateY(0px)",
      }}
    >
      {/* Outer Ambient Glow when Amber pill is active */}
      <div
        className="absolute -inset-2 rounded-full opacity-35 blur-xl transition-opacity duration-700 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, rgba(59, 130, 246, 0.15) 60%, transparent 80%)",
        }}
      />

      {/* 3D Glass Tray Plate */}
      <div className="tuneout-glass-tray relative z-10 flex flex-wrap sm:flex-nowrap items-center p-1.5 gap-1.5 shadow-2xl">
        {modes.map((mode) => {
          const isActive = currentId === mode.id;
          const Icon = mode.icon;
          const isAmber = mode.color === "amber" || (!mode.color && mode.id.includes("exam"));

          return (
            <button
              key={mode.id}
              onClick={() => handleSelect(mode.id)}
              className={`tuneout-pill group ${
                isActive
                  ? isAmber
                    ? "tuneout-pill-amber"
                    : "tuneout-pill-blue"
                  : ""
              }`}
              title={mode.description}
            >
              {/* Leading Icon */}
              <span className="flex items-center justify-center shrink-0">
                <Icon
                  className={`w-4 h-4 transition-transform duration-300 group-hover:scale-110 ${
                    isActive ? "text-white" : "text-slate-700 dark:text-slate-200"
                  }`}
                />
              </span>

              {/* Label */}
              <span className="truncate">{mode.label}</span>

              {/* Trailing 3-Dot Menu Indicator */}
              <span className="tuneout-dots ml-1" aria-hidden="true">
                <span className="tuneout-dot" />
                <span className="tuneout-dot" />
                <span className="tuneout-dot" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
