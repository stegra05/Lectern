import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { highlightCloze, highlightClozeFocus } from '../utils/cloze';
import { renderMathInHtml } from '../utils/mathRendering';

type ClozeMode = 'none' | 'list' | 'focus';

interface MathContentProps {
    html: string;
    className?: string;
    clozeMode?: ClozeMode;
}

function applyCloze(html: string, mode: ClozeMode): string {
    if (mode === 'list') return highlightCloze(html);
    if (mode === 'focus') return highlightClozeFocus(html);
    return html;
}

export const MathContent: React.FC<MathContentProps> = ({
    html,
    className,
    clozeMode = 'none',
}) => {
    const rendered = useMemo(() => {
        const sanitized = DOMPurify.sanitize(html);
        const withCloze = applyCloze(sanitized, clozeMode);
        return renderMathInHtml(withCloze);
    }, [html, clozeMode]);

    return (
        <div
            className={className ? `math-content ${className}` : 'math-content'}
            dangerouslySetInnerHTML={{ __html: rendered }}
        />
    );
};
