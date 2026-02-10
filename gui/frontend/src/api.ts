// Auto-detect API URL based on environment
// If we're served from the packaged app (port 4173), use that
// Otherwise use dev server default (port 8000)
export const getApiUrl = () => {
    if (typeof window !== 'undefined') {
        const port = window.location.port;
        const hostname = window.location.hostname || 'localhost';

        // Special case for Vite dev server default
        if (port === '5173' || port === '5174') {
            return "http://localhost:4173";
        }

        // If we're on a specific port (packaged app), use same origin
        if (port && port !== '80' && port !== '443') {
            return `http://${hostname}:${port}`;
        }
    }
    // Fallback for dev mode
    return "http://localhost:4173";
};

const ENV_API_URL =
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_URL : undefined;
const API_URL = ENV_API_URL || getApiUrl();

const withSessionId = (url: string, sessionId?: string) => {
    if (!sessionId) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}session_id=${encodeURIComponent(sessionId)}`;
};

export interface GenerateRequest {
    pdf_file: File;
    deck_name: string;
    model_name?: string;
    tags?: string[];
    context_deck?: string;
    focus_prompt?: string;
    source_type?: string;  // "auto", "slides", "script"
    target_card_count?: number;
}

// ... (omitting ProgressEvent and others for brevity)


export interface Card {
    front: string;
    back: string;
    anki_note_id?: number;
    fields?: Record<string, string>;
    model_name?: string;
    slide_number?: number;
    slide_topic?: string;
    tag?: string;
    [key: string]: unknown;
}

export interface ProgressEvent {
    type:
        | "session_start"
        | "status"
        | "info"
        | "warning"
        | "error"
        | "progress_start"
        | "progress_update"
        | "card"
        | "note_created"
        | "note_updated"
        | "note_recreated"
        | "done"
        | "cancelled"
        | "step_start"
        | "step_end";
    message: string;
    data?: unknown;
    timestamp: number;
}

export interface HistoryEntry {
    id: string;
    session_id: string;
    filename: string;
    full_path: string;
    deck: string;
    date: string;
    card_count: number;
    status: "draft" | "completed" | "error" | "cancelled";
}

// Helper to make fetch calls with timeout
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs: number = 5000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeout);
        return response;
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
};

const parseNDJSONStream = async (
    res: Response,
    onEvent: (event: ProgressEvent) => void
): Promise<void> => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const event = JSON.parse(line);
                    onEvent(event);
                } catch (e) {
                    console.error("Failed to parse event:", line, e);
                }
            }
        }
    }

    if (buffer.trim()) {
        try {
            const event = JSON.parse(buffer);
            onEvent(event);
        } catch (e) {
            console.error("Failed to parse event:", buffer, e);
        }
    }
};

export interface Estimation {
    tokens: number;
    input_tokens: number;
    output_tokens: number;
    input_cost: number;
    output_cost: number;
    cost: number;
    pages: number;
    text_chars?: number;
    model: string;
    estimated_card_count?: number;
    suggested_card_count?: number;
}

export interface HealthStatus {
    // ... existing interface ...
    anki_connected: boolean;
    gemini_configured: boolean;
    anki_version?: string;
    gemini_model?: string;
}

export interface SessionStatus {
    active: boolean;
    status: string;
}

export const api = {
    checkHealth: async () => {
        try {
            const res = await fetchWithTimeout(`${API_URL}/health`, {}, 3000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            console.warn('Health check failed:', error);
            // Return offline status instead of throwing
            return {
                status: "error",
                anki_connected: false,
                gemini_configured: false,
                backend_ready: false
            };
        }
    },

    getConfig: async () => {
        try {
            const res = await fetchWithTimeout(`${API_URL}/config`, {}, 3000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            console.error('Failed to fetch config:', error);
            throw error;
        }
    },

    getDecks: async () => {
        try {
            const res = await fetchWithTimeout(`${API_URL}/decks`, {}, 3000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            console.error('Failed to fetch decks:', error);
            return { decks: [] };
        }
    },

    createDeck: async (name: string) => {
        const res = await fetch(`${API_URL}/decks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error("Failed to create deck");
        return res.json();
    },

    saveConfig: async (config: {
        gemini_api_key?: string;
        anki_url?: string;
        basic_model?: string;
        cloze_model?: string;
        gemini_model?: string;
    }) => {
        const res = await fetch(`${API_URL}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        return res.json();
    },

    getHistory: async () => {
        try {
            const res = await fetchWithTimeout(`${API_URL}/history`, {}, 3000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            console.error('Failed to fetch history:', error);
            return [];
        }
    },

    clearHistory: async () => {
        const res = await fetch(`${API_URL}/history`, {
            method: "DELETE",
        });
        return res.json();
    },

    deleteHistoryEntry: async (id: string) => {
        const res = await fetch(`${API_URL}/history/${id}`, {
            method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete entry");
        return res.json();
    },

    batchDeleteHistory: async (params: { ids?: string[]; status?: string }) => {
        const res = await fetch(`${API_URL}/history/batch-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        if (!res.ok) throw new Error("Failed to batch delete history");
        return res.json();
    },

    estimateCost: async (
        file: File,
        modelName?: string,
        sourceType: string = "auto",
        targetCardCount?: number,
        signal?: AbortSignal
    ) => {
        const formData = new FormData();
        formData.append("pdf_file", file);
        if (modelName) formData.append("model_name", modelName);
        formData.append("source_type", sourceType);
        if (targetCardCount !== undefined) {
            formData.append("target_card_count", String(targetCardCount));
        }

        try {
            const url = `${API_URL}/estimate`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

            // If an external signal is provided, chain it
            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(timeoutId);
                    controller.abort();
                });
            }

            const res = await fetch(url, {
                method: "POST",
                body: formData,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                console.log('Estimation aborted');
                return null;
            }
            console.error('Failed to estimate cost:', error);
            throw error;
        }
    },

    generate: async (req: GenerateRequest, onEvent: (event: ProgressEvent) => void) => {
        const formData = new FormData();
        formData.append("pdf_file", req.pdf_file);
        formData.append("deck_name", req.deck_name);
        if (req.model_name) formData.append("model_name", req.model_name);
        if (req.tags) formData.append("tags", JSON.stringify(req.tags));
        if (req.context_deck) formData.append("context_deck", req.context_deck);
        formData.append("focus_prompt", req.focus_prompt || "");
        formData.append("source_type", req.source_type ?? "auto");
        if (req.target_card_count !== undefined) {
            formData.append("target_card_count", String(req.target_card_count));
        }

        const res = await fetch(`${API_URL}/generate`, {
            method: "POST",
            body: formData,
        });

        await parseNDJSONStream(res, onEvent);
    },

    stopGeneration: async (sessionId?: string) => {
        const res = await fetch(withSessionId(`${API_URL}/stop`, sessionId), {
            method: "POST",
        });
        return res.json();
    },

    getDrafts: async (sessionId?: string) => {
        const res = await fetch(withSessionId(`${API_URL}/drafts`, sessionId));
        return res.json();
    },

    updateDraft: async (index: number, card: Card, sessionId?: string) => {
        const res = await fetch(withSessionId(`${API_URL}/drafts/${index}`, sessionId), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ card }),
        });
        if (!res.ok) throw new Error("Failed to update draft");
        return res.json();
    },

    deleteDraft: async (index: number, sessionId?: string) => {
        const res = await fetch(withSessionId(`${API_URL}/drafts/${index}`, sessionId), {
            method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete draft");
        return res.json();
    },

    syncDrafts: async (onEvent: (event: ProgressEvent) => void, sessionId?: string) => {
        const res = await fetch(withSessionId(`${API_URL}/drafts/sync`, sessionId), {
            method: "POST",
        });

        await parseNDJSONStream(res, onEvent);
    },

    getSession: async (sessionId: string) => {
        const res = await fetch(`${API_URL}/session/${sessionId}`);
        if (!res.ok) throw new Error("Failed to load session");
        return res.json();
    },

    getSessionStatus: async (sessionId: string): Promise<SessionStatus> => {
        const res = await fetch(`${API_URL}/session/${sessionId}/status`);
        if (!res.ok) throw new Error("Failed to load session status");
        return res.json();
    },

    updateSessionCards: async (sessionId: string, cards: Card[]) => {
        const res = await fetch(`${API_URL}/session/${sessionId}/cards`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cards }),
        });
        if (!res.ok) throw new Error("Failed to update session cards");
        return res.json();
    },

    syncSessionToAnki: async (sessionId: string, onEvent: (event: ProgressEvent) => void) => {
        const res = await fetch(`${API_URL}/session/${sessionId}/sync`, {
            method: "POST",
        });

        await parseNDJSONStream(res, onEvent);
    },

    deleteSessionCard: async (sessionId: string, cardIndex: number) => {
        const res = await fetchWithTimeout(`${API_URL}/session/${sessionId}/cards/${cardIndex}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete card from session');
        return res.json();
    },

    deleteAnkiNotes: async (noteIds: number[]) => {
        const res = await fetchWithTimeout(`${API_URL}/anki/notes`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_ids: noteIds }),
        });
        if (!res.ok) throw new Error('Failed to delete notes from Anki');
        return res.json();
    },

    updateAnkiNote: async (noteId: number, fields: Record<string, string>) => {
        const res = await fetchWithTimeout(`${API_URL}/anki/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields }),
        });
        if (!res.ok) throw new Error('Failed to update Anki note');
        return res.json();
    },

    getVersion: async (): Promise<{ current: string; latest: string | null; update_available: boolean; release_url: string }> => {
        const res = await fetchWithTimeout(`${API_URL}/version`);
        if (!res.ok) throw new Error('Failed to fetch version info');
        return res.json();
    },

    getApiUrl: () => API_URL,
};
