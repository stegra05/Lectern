import { motion } from 'framer-motion';
import type { Phase } from './PhaseIndicator';

interface PhaseAnimationProps {
    phase: Phase;
    className?: string;
}

/** Concept map: nodes forming connections. */
function ConceptAnimation() {
    const nodes = [
        { cx: 3, cy: 3 },
        { cx: 13, cy: 3 },
        { cx: 8, cy: 13 },
    ];
    const edges = [
        { x1: 3, y1: 3, x2: 13, y2: 3 },
        { x1: 13, y1: 3, x2: 8, y2: 13 },
        { x1: 8, y1: 13, x2: 3, y2: 3 },
    ];

    return (
        <svg viewBox="0 0 16 16" className="w-4 h-4">
            {edges.map((e, i) => (
                <motion.path
                    key={i}
                    d={`M${e.x1} ${e.y1} L${e.x2} ${e.y2}`}
                    stroke="currentColor"
                    fill="none"
                    strokeWidth={1.2}
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 0.3 }}
                    animate={{ pathLength: 1, opacity: [0.3, 0.8, 0.3] }}
                    transition={{
                        pathLength: { duration: 1.5, delay: i * 0.4, repeat: Infinity, repeatType: 'loop', ease: 'easeInOut' },
                        opacity: { duration: 2, delay: i * 0.3, repeat: Infinity, ease: 'easeInOut' },
                    }}
                />
            ))}
            {nodes.map((n, i) => (
                <motion.circle
                    key={i}
                    cx={n.cx} cy={n.cy} r={1.8}
                    fill="currentColor"
                    initial={{ scale: 0.6, opacity: 0.4 }}
                    animate={{ scale: [0.6, 1, 0.6], opacity: [0.4, 1, 0.4] }}
                    transition={{
                        duration: 1.8,
                        delay: i * 0.5,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                />
            ))}
        </svg>
    );
}

/** Generating: stacked cards fanning out with a sparkle. */
function GeneratingAnimation() {
    return (
        <svg viewBox="0 0 16 16" className="w-4 h-4">
            {/* Bottom card */}
            <motion.rect
                x={3} y={4} width={10} height={9} rx={1.5}
                fill="none" stroke="currentColor" strokeWidth={1.2}
                initial={{ x: 3, y: 4 }}
                animate={{ x: [3, 2, 3], y: [4, 5, 4] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                opacity={0.35}
            />
            {/* Top card */}
            <motion.rect
                x={3} y={3} width={10} height={9} rx={1.5}
                fill="none" stroke="currentColor" strokeWidth={1.2}
                initial={{ x: 3, y: 3 }}
                animate={{ x: [3, 4, 3], y: [3, 2, 3] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                opacity={0.7}
            />
            {/* Sparkle dot */}
            <motion.circle
                cx={12} cy={3} r={1}
                fill="currentColor"
                animate={{
                    scale: [0, 1.3, 0],
                    opacity: [0, 1, 0],
                }}
                transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />
            {/* Sparkle rays */}
            {[0, 90, 45, 135].map((angle, i) => {
                const rad = (angle * Math.PI) / 180;
                const len = 2.5;
                return (
                    <motion.path
                        key={angle}
                        d={`M12 3 L${12 + Math.cos(rad) * len} ${3 + Math.sin(rad) * len}`}
                        stroke="currentColor"
                        fill="none"
                        strokeWidth={0.8}
                        strokeLinecap="round"
                        animate={{
                            opacity: [0, 0.8, 0],
                            pathLength: [0, 1, 0],
                        }}
                        transition={{
                            duration: 1.4,
                            delay: i * 0.15,
                            repeat: Infinity,
                            ease: 'easeInOut',
                        }}
                    />
                );
            })}
        </svg>
    );
}

/** Reflecting: brain with pulsing thought waves. */
function ReflectingAnimation() {
    return (
        <svg viewBox="0 0 16 16" className="w-4 h-4">
            {/* Simple brain/lens shape */}
            <motion.circle
                cx={8} cy={8} r={4}
                fill="none" stroke="currentColor" strokeWidth={1.3}
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            {/* Inner detail */}
            <motion.path
                d="M6 8 Q8 5 10 8 Q8 11 6 8"
                fill="none" stroke="currentColor" strokeWidth={0.9}
                strokeLinecap="round"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            {/* Expanding thought rings */}
            {[0, 1, 2].map((i) => (
                <motion.circle
                    key={i}
                    cx={8} cy={8} r={4}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={0.6}
                    initial={{ r: 4, opacity: 0.6 }}
                    animate={{ r: [4, 7.5], opacity: [0.5, 0] }}
                    transition={{
                        duration: 2.2,
                        delay: i * 0.7,
                        repeat: Infinity,
                        ease: 'easeOut',
                    }}
                />
            ))}
        </svg>
    );
}

/**
 * Renders a phase-specific animated icon for the active generation phase.
 * Replaces the generic spinning Loader2 in PhaseIndicator.
 */
export function PhaseAnimation({ phase, className }: PhaseAnimationProps) {
    const wrapClass = className ?? 'text-background';

    switch (phase) {
        case 'concept':
            return <span className={wrapClass}><ConceptAnimation /></span>;
        case 'generating':
            return <span className={wrapClass}><GeneratingAnimation /></span>;
        case 'reflecting':
            return <span className={wrapClass}><ReflectingAnimation /></span>;
        default:
            return null;
    }
}
