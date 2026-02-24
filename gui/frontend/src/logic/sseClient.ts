/**
 * SSE Client for POST requests
 *
 * Native EventSource only supports GET requests. This utility provides
 * SSE parsing for POST-based streaming endpoints like /generate.
 */

export interface SSEEvent {
    event: string;
    data: unknown;
}

/**
 * Parse a Server-Sent Events stream from a POST response.
 *
 * SSE format:
 * - Lines starting with "event:" define the event type
 * - Lines starting with "data:" contain JSON payload
 * - Empty lines separate events
 *
 * @param response - The fetch Response object with a readable body
 * @param onEvent - Callback called for each parsed event
 */
export async function parseSSEStream(
    response: Response,
    onEvent: (event: SSEEvent) => void
): Promise<void> {
    if (!response.body) {
        throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let currentEvent = '';
    let currentData = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('event:')) {
                    currentEvent = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    currentData = line.slice(5).trim();
                } else if (line.trim() === '') {
                    // Empty line signals end of event
                    if (currentEvent || currentData) {
                        let parsedData: unknown;
                        try {
                            parsedData = currentData ? JSON.parse(currentData) : null;
                        } catch {
                            parsedData = currentData;
                        }

                        onEvent({
                            event: currentEvent,
                            data: parsedData,
                        });

                        currentEvent = '';
                        currentData = '';
                    }
                }
            }
        }

        // Handle any remaining content in buffer
        if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith('event:')) {
                currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                currentData = line.slice(5).trim();
            }

            if (currentEvent || currentData) {
                let parsedData: unknown;
                try {
                    parsedData = currentData ? JSON.parse(currentData) : null;
                } catch {
                    parsedData = currentData;
                }

                onEvent({
                    event: currentEvent,
                    data: parsedData,
                });
            }
        }
    } finally {
        reader.releaseLock();
    }
}
