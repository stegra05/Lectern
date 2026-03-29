/**
 * Error message translation utilities for converting technical errors
 * into user-friendly messages with actionable guidance.
 */

export interface FriendlyError {
    title: string;
    message: string;
    action?: string;
    errorCode?: string;
}

/**
 * Patterns for detecting error types from technical error messages.
 */
const ERROR_PATTERNS = {
    apiKey: /api[_-]?key|401|unauthorized|invalid.*key|authentication.*fail/i,
    ankiConnect: /anki|ankiconnect|connection refused|anki.*not.*running|localhost:8765/i,
    timeout: /timeout|timed out|etimedout/i,
    network: /network|fetch|econnrefused|enotfound|dns|internet|offline/i,
    serverError: /500|502|503|504|internal server error|bad gateway|service unavailable/i,
    spendingCap: /resource_exhausted|spending cap|quota exceeded|insufficient quota|billing.*limit/i,
    rateLimit: /429|rate limit|too many requests/i,
    badRequest: /400|bad request|invalid.*request/i,
} as const;

/**
 * Extracts a concise error code from an error for debugging purposes.
 * This appears in smaller text to help with troubleshooting.
 */
function extractErrorCode(error: unknown): string | undefined {
    if (!error) return undefined;

    if (error instanceof Error) {
        // Try to extract HTTP status code
        const httpMatch = error.message.match(/HTTP\s*(\d{3})/i);
        if (httpMatch) return `HTTP ${httpMatch[1]}`;

        // Try to extract common error codes
        const codeMatch = error.message.match(/\b(E[A-Z]+\d*)\b/i);
        if (codeMatch) return codeMatch[1].toUpperCase();

        // Return first ~50 chars of message if no specific code found
        const trimmed = error.message.trim().slice(0, 50);
        return trimmed.length < error.message.trim().length ? `${trimmed}...` : trimmed;
    }

    if (typeof error === 'string') {
        const httpMatch = error.match(/HTTP\s*(\d{3})/i);
        if (httpMatch) return `HTTP ${httpMatch[1]}`;

        const trimmed = error.trim().slice(0, 50);
        return trimmed.length < error.trim().length ? `${trimmed}...` : trimmed;
    }

    return undefined;
}

/**
 * Translates a technical error into a user-friendly message.
 *
 * @param error - The original error (Error object, string, or unknown)
 * @param context - Optional context about where the error occurred
 * @returns A FriendlyError object with user-friendly messaging
 */
export function translateError(error: unknown, context?: 'estimation' | 'generation' | 'sync' | 'general'): FriendlyError {
    const errorCode = extractErrorCode(error);
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');

    // API Key / Authentication errors
    if (ERROR_PATTERNS.apiKey.test(message)) {
        return {
            title: 'Authentication Failed',
            message: 'Your Gemini API key may be invalid or expired.',
            action: 'Check your API key in Settings.',
            errorCode,
        };
    }

    // AnkiConnect errors
    if (ERROR_PATTERNS.ankiConnect.test(message)) {
        return {
            title: "Can't Connect to Anki",
            message: 'Lectern could not reach AnkiConnect.',
            action: 'Please make sure Anki is running and AnkiConnect is installed.',
            errorCode,
        };
    }

    // Timeout errors
    if (ERROR_PATTERNS.timeout.test(message)) {
        const contextMessage = context === 'estimation'
            ? 'The document analysis took too long. Your file may be too large.'
            : context === 'sync'
                ? 'The sync operation timed out. Try syncing fewer cards at once.'
                : 'The request timed out. Your file may be too large.';

        return {
            title: 'Request Timed Out',
            message: contextMessage,
            action: 'Try again with a smaller file or check your connection.',
            errorCode,
        };
    }

    // Network errors
    if (ERROR_PATTERNS.network.test(message)) {
        return {
            title: 'Network Error',
            message: 'Could not connect to the server.',
            action: 'Check your internet connection and try again.',
            errorCode,
        };
    }

    // Billing / spending-cap errors
    if (ERROR_PATTERNS.spendingCap.test(message)) {
        return {
            title: 'Billing Limit Reached',
            message: 'Your Gemini project has exceeded its spending cap.',
            action: 'Increase the spending cap or switch to another API project/key, then try again.',
            errorCode,
        };
    }

    // Server errors (5xx)
    if (ERROR_PATTERNS.serverError.test(message)) {
        return {
            title: 'Server Error',
            message: 'The server encountered an unexpected error.',
            action: 'Please try again in a moment.',
            errorCode,
        };
    }

    // Rate limiting
    if (ERROR_PATTERNS.rateLimit.test(message)) {
        return {
            title: 'Too Many Requests',
            message: "You've hit the API rate limit.",
            action: 'Wait a moment before trying again.',
            errorCode,
        };
    }

    // Bad request
    if (ERROR_PATTERNS.badRequest.test(message)) {
        return {
            title: 'Invalid Request',
            message: 'The request could not be processed.',
            action: 'Check your input and try again.',
            errorCode,
        };
    }

    // Generic fallback based on context
    const contextFallbacks: Record<string, { title: string; message: string; action?: string }> = {
        estimation: {
            title: 'Estimation Failed',
            message: 'Could not analyze the document.',
            action: 'Try a different PDF or check your API key.',
        },
        generation: {
            title: 'Generation Failed',
            message: 'An error occurred while generating cards.',
            action: 'Try again or check the logs for details.',
        },
        sync: {
            title: 'Sync Failed',
            message: 'Could not sync cards to Anki.',
            action: 'Make sure Anki is running and try again.',
        },
        general: {
            title: 'Something Went Wrong',
            message: 'An unexpected error occurred.',
            action: 'Please try again.',
        },
    };

    const fallback = contextFallbacks[context || 'general'];
    return {
        ...fallback,
        errorCode,
    };
}

/**
 * Gets a user-friendly error message for estimation failures.
 * This is a convenience wrapper around translateError.
 */
export function getEstimationError(error: unknown): FriendlyError {
    return translateError(error, 'estimation');
}

/**
 * Gets a user-friendly error message for generation failures.
 * This is a convenience wrapper around translateError.
 */
export function getGenerationError(error: unknown): FriendlyError {
    return translateError(error, 'generation');
}

/**
 * Gets a user-friendly error message for sync failures.
 * This is a convenience wrapper around translateError.
 */
export function getSyncError(error: unknown): FriendlyError {
    return translateError(error, 'sync');
}

/**
 * Formats a FriendlyError for display in logs or debugging.
 */
export function formatFriendlyError(error: FriendlyError): string {
    const parts = [error.title, error.message];
    if (error.action) parts.push(error.action);
    if (error.errorCode) parts.push(`[${error.errorCode}]`);
    return parts.join(' ');
}
