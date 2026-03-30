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

const renderedCache = new Map<string, string>();
const MAX_RENDERED_CACHE_SIZE = 200;

export const MathContent: React.FC<MathContentProps> = ({
    html,
    className,
    clozeMode = 'none',
}) => {
    const rendered = useMemo(() => {
        const cacheKey = `${clozeMode}::${html}`;
        const cached = renderedCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        const sanitized = DOMPurify.sanitize(html);
        const withCloze = applyCloze(sanitized, clozeMode);
        const output = renderMathInHtml(withCloze);

        renderedCache.set(cacheKey, output);
        if (renderedCache.size > MAX_RENDERED_CACHE_SIZE) {
            const oldestKey = renderedCache.keys().next().value;
            if (typeof oldestKey === 'string') {
                renderedCache.delete(oldestKey);
            }
        }

        return output;
    }, [html, clozeMode]);

    return (
        <div
            className={className ? `math-content ${className}` : 'math-content'}
            dangerouslySetInnerHTML={{ __html: rendered }}
        />
    );
};
