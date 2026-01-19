import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => {
            const { initial, animate, exit, variants, transition, ...validProps } = props;
            return React.createElement('div', validProps, children);
        },
    },
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));
