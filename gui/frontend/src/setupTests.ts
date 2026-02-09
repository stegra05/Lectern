import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';

vi.mock('framer-motion', () => ({
    motion: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        div: ({ children, ...props }: any) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {
                initial,
                animate,
                exit,
                variants,
                transition,
                layout,
                layoutId,
                ...validProps
            } = props;
            return React.createElement('div', validProps, children);
        },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));
