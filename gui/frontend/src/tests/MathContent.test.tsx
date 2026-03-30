import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MathContent } from '../components/MathContent';

describe('MathContent', () => {
    it('does not leak cloze HTML tags into KaTeX output when cloze is embedded in math', () => {
        const input =
            'The optimization objective is: \\(\\theta^* = \\min_\\theta \\sum_{i=1}^{n} {{c1::L(f(x_i), y_i, \\theta)}}\\).';

        const { container } = render(<MathContent html={input} clozeMode="list" />);
        const html = container.innerHTML;

        expect(html).toContain('katex');
        expect(html).not.toContain('spanclass');
        expect(html).not.toContain('&lt;span');
        expect(html).not.toContain('{{c1::');
        expect(html).toContain('L');
    });
});
