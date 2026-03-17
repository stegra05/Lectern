import { validateOrThrow } from './schemas/validate';
import { ProgressEventSchema } from './schemas/sse';
import {
  AnkiNoteResponseSchema,
  AnkiStatusSchema,
  ConfigSchema,
  CreateDeckResponseSchema,
  DecksResponseSchema,
  EstimationSchema,
  HealthStatusSchema,
  HistoryBatchDeleteResponseSchema,
  HistoryClearResponseSchema,
  HistoryDeleteResponseSchema,
  HistoryResponseSchema,
  SaveConfigResponseSchema,
  SessionDataSchema,
  StopResponseSchema,
  VersionSchema,
} from './schemas/api';
import type {
  AnkiNoteResponse,
  AnkiStatus,
  Card,
  Config,
  CreateDeckResponse,
  DecksResponse,
  Estimation,
  HealthStatus,
  HistoryBatchDeleteResponse,
  HistoryClearResponse,
  HistoryDeleteResponse,
  HistoryResponse,
  SaveConfigResponse,
  SessionData,
  StopResponse,
  Version,
} from './schemas/api';

// Re-export types for backward compatibility
export type {
  Card,
  Estimation,
  HealthStatus,
  SessionData,
} from './schemas/api';

export type { HistoryEntry } from './schemas/api';

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
    target_card_count?: number;
}

// Coverage types needed for SessionData
export interface CoverageConcept {
    id: string;
    name: string;
    importance: string;
    difficulty?: string;
    page_references?: number[];
}

export interface CoverageData {
    total_pages: number;
    document_type?: string | null;
    concept_catalog?: CoverageConcept[];
    relation_catalog?: Array<Record<string, unknown>>;
    covered_pages?: number[];
    uncovered_pages?: number[];
    covered_page_count?: number;
    page_coverage_pct?: number;
    saturated_pages?: number[];
    explicit_concept_count?: number;
    explicit_concept_coverage_pct?: number;
    covered_concept_ids?: string[];
    covered_concept_count?: number;
    total_concepts?: number;
    concept_coverage_pct?: number;
    explicit_relation_count?: number;
    covered_relation_count?: number;
    total_relations?: number;
    relation_coverage_pct?: number;
    high_priority_total?: number;
    high_priority_covered?: number;
    missing_high_priority?: CoverageConcept[];
    uncovered_concepts?: CoverageConcept[];
    uncovered_relations?: Array<Record<string, unknown>>;
}

export type SnapshotStatus =
    | 'idle'
    | 'concept'
    | 'generating'
    | 'reflecting'
    | 'exporting'
    | 'complete'
    | 'error'
    | 'cancelled';

export interface ControlSnapshot {
    session_id: string;
    timestamp: number;
    status: SnapshotStatus;
    progress: { current: number; total: number };
    concept_progress: { current: number; total: number };
    /** Count only — NOT the full cards array */
    card_count: number;
    total_pages: number;
    coverage_data: CoverageData | null;
    is_error: boolean;
    error_message: string | null;
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
    | "card"
    | "cards_replaced"
    | "done"
    | "cancelled"
    | "step_start"
    | "step_end"
    | "control_snapshot";
    message: string;
    data?: unknown;
    timestamp: number;
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

    const emitValidated = (raw: unknown) => {
        const event = validateOrThrow(ProgressEventSchema, raw);
        onEvent(event as ProgressEvent);
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const raw = JSON.parse(line);
                    emitValidated(raw);
                } catch (e) {
                    console.error("Failed to parse/validate event:", line, e);
                    throw e;
                }
            }
        }
    }

    if (buffer.trim()) {
        try {
            const raw = JSON.parse(buffer);
            emitValidated(raw);
        } catch (e) {
            console.error("Failed to parse/validate event:", buffer, e);
            throw e;
        }
    }
};

export interface SessionStatus {
    active: boolean;
    status: string;
}

export const api = {
    checkHealth: async (): Promise<HealthStatus> => {
        const res = await fetchWithTimeout(`${API_URL}/health`, {}, 3000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return validateOrThrow(HealthStatusSchema, await res.json());
    },

    getAnkiStatus: async (): Promise<AnkiStatus> => {
        const res = await fetchWithTimeout(`${API_URL}/anki/status`, {}, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return validateOrThrow(AnkiStatusSchema, await res.json());
    },

    getConfig: async (): Promise<Config> => {
        try {
            const res = await fetchWithTimeout(`${API_URL}/config`, {}, 3000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return validateOrThrow(ConfigSchema, data);
        } catch (error) {
            console.error('Failed to fetch config:', error);
            throw error;
        }
    },

    getDecks: async (): Promise<DecksResponse> => {
        const res = await fetchWithTimeout(`${API_URL}/decks`, {}, 3000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return validateOrThrow(DecksResponseSchema, await res.json());
    },

    createDeck: async (name: string): Promise<CreateDeckResponse> => {
        const res = await fetch(`${API_URL}/decks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error("Failed to create deck");
        return validateOrThrow(CreateDeckResponseSchema, await res.json());
    },

    saveConfig: async (config: {
        gemini_api_key?: string;
        anki_url?: string;
        basic_model?: string;
        cloze_model?: string;
        gemini_model?: string;
        tag_template?: string;
    }): Promise<SaveConfigResponse> => {
        const res = await fetch(`${API_URL}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        if (!res.ok) throw new Error("Failed to save config");
        return validateOrThrow(SaveConfigResponseSchema, await res.json());
    },

    getHistory: async (): Promise<HistoryResponse> => {
        const res = await fetchWithTimeout(`${API_URL}/history`, {}, 3000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return validateOrThrow(HistoryResponseSchema, await res.json());
    },

    clearHistory: async (): Promise<HistoryClearResponse> => {
        const res = await fetch(`${API_URL}/history`, {
            method: "DELETE",
        });
        return validateOrThrow(HistoryClearResponseSchema, await res.json());
    },

    deleteHistoryEntry: async (id: string): Promise<HistoryDeleteResponse> => {
        const res = await fetch(`${API_URL}/history/${id}`, {
            method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete entry");
        return validateOrThrow(HistoryDeleteResponseSchema, await res.json());
    },

    batchDeleteHistory: async (params: { ids?: string[]; status?: string }): Promise<HistoryBatchDeleteResponse> => {
        const res = await fetch(`${API_URL}/history/batch-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        if (!res.ok) throw new Error("Failed to batch delete history");
        return validateOrThrow(HistoryBatchDeleteResponseSchema, await res.json());
    },

    estimateCost: async (
        file: File,
        modelName?: string,
        targetCardCount?: number,
        signal?: AbortSignal
    ): Promise<Estimation> => {
        const formData = new FormData();
        formData.append("pdf_file", file);
        if (modelName) formData.append("model_name", modelName);
        if (targetCardCount !== undefined) {
            formData.append("target_card_count", String(targetCardCount));
        }

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
        return validateOrThrow(EstimationSchema, await res.json());
    },

    generate: async (req: GenerateRequest, onEvent: (event: ProgressEvent) => void) => {
        const formData = new FormData();
        formData.append("pdf_file", req.pdf_file);
        formData.append("deck_name", req.deck_name);
        if (req.model_name) formData.append("model_name", req.model_name);
        if (req.tags) formData.append("tags", JSON.stringify(req.tags));
        if (req.context_deck) formData.append("context_deck", req.context_deck);
        formData.append("focus_prompt", req.focus_prompt || "");
        if (req.target_card_count !== undefined) {
            formData.append("target_card_count", String(req.target_card_count));
        }

        const res = await fetch(`${API_URL}/generate`, {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`HTTP ${res.status}: ${errBody}`);
        }

        await parseNDJSONStream(res, onEvent);
    },

    stopGeneration: async (sessionId?: string): Promise<StopResponse> => {
        const res = await fetch(withSessionId(`${API_URL}/stop`, sessionId), {
            method: "POST",
        });
        return validateOrThrow(StopResponseSchema, await res.json());
    },

    getSession: async (sessionId: string): Promise<SessionData> => {
        const res = await fetch(`${API_URL}/session/${sessionId}`);
        if (!res.ok) throw new Error("Failed to load session");
        const data = await res.json();
      return validateOrThrow(SessionDataSchema, data);
    },

    syncCardsToAnki: async (
        payload: { cards: Card[]; deck_name: string; tags: string[]; slide_set_name: string; allow_updates: boolean },
        onEvent: (event: ProgressEvent) => void
    ) => {
        const res = await fetch(`${API_URL}/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Sync failed");
        await parseNDJSONStream(res, onEvent);
    },

    deleteAnkiNotes: async (noteIds: number[]): Promise<AnkiNoteResponse> => {
        const res = await fetchWithTimeout(`${API_URL}/anki/notes`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_ids: noteIds }),
        });
        if (!res.ok) throw new Error('Failed to delete notes from Anki');
        return validateOrThrow(AnkiNoteResponseSchema, await res.json());
    },

    updateAnkiNote: async (noteId: number, fields: Record<string, string>): Promise<AnkiNoteResponse> => {
        const res = await fetchWithTimeout(`${API_URL}/anki/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields }),
        });
        if (!res.ok) throw new Error('Failed to update Anki note');
        return validateOrThrow(AnkiNoteResponseSchema, await res.json());
    },

    getVersion: async (): Promise<Version> => {
        const res = await fetchWithTimeout(`${API_URL}/version`);
        if (!res.ok) throw new Error('Failed to fetch version info');
        const data = await res.json();
        return validateOrThrow(VersionSchema, data);
    },

    /** Check AnkiConnect at an arbitrary URL (e.g. user-edited URL in settings). */
    checkAnkiConnectUrl: async (url: string): Promise<{ connected: boolean }> => {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'version', version: 6 }),
            signal: AbortSignal.timeout(3000),
        });
        return { connected: res.ok };
    },

    getApiUrl: () => API_URL,
};
