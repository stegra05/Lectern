import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MathContent } from '../components/MathContent';
import * as mathRendering from '../utils/mathRendering';

afterEach(() => {
    vi.restoreAllMocks();
});

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

    it('reuses rendered math output for identical payload across remounts', () => {
        const spy = vi.spyOn(mathRendering, 'renderMathInHtml');
        const props = { html: 'Compute \\(a^2 + b^2\\)', clozeMode: 'none' as const };

        const first = render(<MathContent {...props} />);
        first.unmount();
        render(<MathContent {...props} />);

        expect(spy).toHaveBeenCalledTimes(1);
    });
});
