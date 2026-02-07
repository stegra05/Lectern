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

const API_URL = getApiUrl();

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
    exam_mode?: boolean;
    source_type?: string;  // "auto", "slides", "script"
    density_target?: number;  // Detail level: 0.8 (concise) to 2.5 (comprehensive)
}

export interface ProgressEvent {
    type: "session_start" | "status" | "info" | "warning" | "error" | "progress_start" | "progress_update" | "card_generated" | "note_created" | "done" | "cancelled" | "step_start";
    message: string;
    data?: any;
    timestamp: number;
}

export interface HistoryEntry {
    id: string;
    filename: string;
    full_path: string;
    deck: string;
    date: string;
    card_count: number;
    status: "draft" | "completed" | "error";
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

export interface Estimation {
    tokens: number;
    cost: number;
}

export interface HealthStatus {
    anki_connected: boolean;
    gemini_configured: boolean;
    anki_version?: string;
    gemini_model?: string;
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

    estimateCost: async (file: File, signal?: AbortSignal) => {
        const formData = new FormData();
        formData.append("pdf_file", file);

        try {
            const res = await fetch(`${API_URL}/estimate`, {
                method: "POST",
                body: formData,
                signal: signal
            });
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
        formData.append("exam_mode", String(req.exam_mode ?? false));
        formData.append("source_type", req.source_type ?? "auto");
        if (req.density_target !== undefined) {
            formData.append("density_target", String(req.density_target));
        }

        const res = await fetch(`${API_URL}/generate`, {
            method: "POST",
            body: formData,
        });

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

    updateDraft: async (index: number, card: any, sessionId?: string) => {
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
    },

    getApiUrl: () => API_URL,
};
