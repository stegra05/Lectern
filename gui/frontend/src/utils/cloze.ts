/**
 * Utility functions for rendering Anki Cloze deletion strings in the frontend.
 * Supports patterns like {{c1::answer}} and {{c2::answer::hint}}.
 */

/**
 * Renders the front side of a Cloze card by replacing all deletions with [...]
 * or with their hint if provided.
 */
export function renderClozeFront(text: string): string {
    return text.replace(
        /\{\{c\d+::(.+?)(?:::(.+?))?\}\}/g,
        (_match, _answer, hint) => {
            return `<span class="cloze-placeholder">[${hint || '...'}]</span>`;
        }
    );
}

/**
 * Renders the back side of a Cloze card by highlighting the answers.
 */
export function renderClozeBack(text: string): string {
    return text.replace(
        /\{\{c\d+::(.+?)(?:::(.+?))?\}\}/g,
        (_match, answer, _hint) => {
            return `<span class="cloze-answer">${answer}</span>`;
        }
    );
}

/**
 * Highlights Cloze patterns with a styled span for general UI display (e.g. lists).
 */
export function highlightCloze(html: string): string {
    return html.replace(
        /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g,
        (_match, num, answer, hint) => {
            const label = hint ? `${answer} (${hint})` : answer;
            return `<span class="cloze-hl" data-cloze="${num}">${label}</span>`;
        }
    );
}
