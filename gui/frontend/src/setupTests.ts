import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';

interface MockProps {
    children?: React.ReactNode;
    [key: string]: unknown;
}

const filterMotionProps = (props: Record<string, unknown>) => {
    const forbidden = [
        'initial',
        'animate',
        'exit',
        'variants',
        'transition',
        'layout',
        'layoutId',
        'drag',
        'dragConstraints',
        'dragElastic',
        'onDragEnd',
        'custom',
    ];
    return Object.fromEntries(
        Object.entries(props).filter(([key]) => !forbidden.includes(key))
    );
};

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: MockProps) => {
            return React.createElement('div', filterMotionProps(props), children);
        },
        span: ({ children, ...props }: MockProps) => {
            return React.createElement('span', filterMotionProps(props), children);
        },
        circle: ({ children, ...props }: MockProps) => {
            return React.createElement('circle', filterMotionProps(props), children);
        },
        path: ({ children, ...props }: MockProps) => {
            return React.createElement('path', filterMotionProps(props), children);
        },
        svg: ({ children, ...props }: MockProps) => {
            return React.createElement('svg', filterMotionProps(props), children);
        },
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useMotionValue: (initial: number) => initial,
    useTransform: (value: unknown) => value,
}));
