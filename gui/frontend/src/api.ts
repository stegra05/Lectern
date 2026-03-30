import createClient from 'openapi-fetch';

import type { components, paths } from './generated/api';
import { ProgressEventSchema } from './schemas/sse';
import { ApiEventV2Schema } from './schemas/sse-v2';
import { validateOrThrow } from './schemas/validate';
import type {
  AnkiNoteResponse,
  AnkiStatus,
  Card,
  Config,
  CoverageData,
  CreateDeckResponse,
  DecksResponse,
  Estimation,
  HealthStatus,
    HistoryBatchDeleteResponse,
    HistoryClearResponse,
    HistoryDeleteResponse,
    HistoryResponse,
    LogsClearResponse,
  SaveConfigPayload,
  SaveConfigResponse,
  SessionData,
  StopResponse,
  Version,
} from './schemas/api';

// Re-export types for backward compatibility
export type {
  Card,
  CoverageData,
  Estimation,
  HealthStatus,
  SessionData,
  HistoryEntry,
} from './schemas/api';

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
const apiClient = createClient<paths>({ baseUrl: API_URL });
const V2_GENERATE_PATH = '/generate-v2' as const;
const V2_ESTIMATE_PATH = '/estimate-v2';
const V2_STOP_PATH = '/stop-v2';
const V2_SESSION_PATH = '/session-v2';

export interface GenerateRequest {
    pdf_file: File;
    deck_name: string;
    model_name?: string;
    tags?: string[];
    context_deck?: string;
    focus_prompt?: string;
    target_card_count?: number;
    session_id?: string;
    after_sequence_no?: number;
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
    | "session_resumed"
    | "status"
    | "info"
    | "warning"
    | "error"
    | "progress_start"
    | "progress_update"
    | "card"
    | "note"
    | "note_created"
    | "note_updated"
    | "note_recreated"
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

export interface ProgressEventV2 {
    event_version: 2;
    session_id: string;
    sequence_no: number;
    type:
    | "session_started"
    | "phase_started"
    | "progress_updated"
    | "card_emitted"
    | "cards_replaced"
    | "warning_emitted"
    | "error_emitted"
    | "phase_completed"
    | "session_completed"
    | "session_cancelled";
    message: string;
    data?: unknown;
    timestamp: number;
}

export interface SyncPreview {
    total_cards: number;
    create_candidates: number;
    update_candidates: number;
    existing_note_matches: number;
    missing_note_ids: number;
    invalid_note_ids: number;
    conflict_count: number;
    note_lookup_error?: string | null;
}

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

const parseNDJSONStreamV2 = async (
    res: Response,
    onEvent: (event: ProgressEventV2) => void
): Promise<void> => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const pending: ProgressEventV2[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (pending.length === 0) return;
        const batch = pending.splice(0, pending.length);
        for (const event of batch) {
            onEvent(event);
        }
    };

    const emitValidated = (raw: unknown) => {
        const event = validateOrThrow(ApiEventV2Schema, raw);
        const typed = event as ProgressEventV2;
        if (
            typed.type === "error_emitted" ||
            typed.type === "session_completed" ||
            typed.type === "session_cancelled"
        ) {
            flushPending();
            onEvent(typed);
            return;
        }
        pending.push(typed);
        if (pending.length >= 25) {
            flushPending();
            return;
        }
        if (!flushTimer) {
            flushTimer = setTimeout(() => {
                flushPending();
            }, 16);
        }
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
    flushPending();
};

export interface SessionStatus {
    active: boolean;
    status: string;
}

const unwrapData = <T>(
    payload: { data?: T; error?: unknown; response: Response },
    fallbackMessage: string
): T => {
    const { data, error, response } = payload;
    if (response.ok && data !== undefined) return data;
    if (error) throw new Error(fallbackMessage);
    throw new Error(`HTTP ${response.status}`);
};

const normalizeEstimation = (raw: Record<string, unknown>): Estimation => ({
    tokens: Number(raw.tokens ?? 0),
    input_tokens: Number(raw.input_tokens ?? 0),
    output_tokens: Number(raw.output_tokens ?? 0),
    input_cost: Number(raw.input_cost ?? 0),
    output_cost: Number(raw.output_cost ?? 0),
    cost: Number(raw.cost ?? 0),
    pages: Number(raw.pages ?? 0),
    text_chars: raw.text_chars == null ? undefined : Number(raw.text_chars),
    model: String(raw.model ?? ''),
    suggested_card_count:
        raw.suggested_card_count == null ? undefined : Number(raw.suggested_card_count),
    estimated_card_count:
        raw.estimated_card_count == null ? undefined : Number(raw.estimated_card_count),
    image_count: raw.image_count == null ? undefined : Number(raw.image_count),
    document_type: raw.document_type == null ? undefined : String(raw.document_type),
});

export const api = {
    checkHealth: async (): Promise<HealthStatus> => {
        const data = unwrapData(await apiClient.GET('/health'), 'Failed to fetch health status');
        return { ...data, backend_ready: data.backend_ready ?? true };
    },

    getAnkiStatus: async (): Promise<AnkiStatus> => {
        return unwrapData(await apiClient.GET('/anki/status'), 'Failed to fetch Anki status');
    },

    getConfig: async (): Promise<Config> => {
        const data = unwrapData(await apiClient.GET('/config'), 'Failed to fetch config');
        return { ...data, gemini_configured: data.gemini_configured ?? false };
    },

    getDecks: async (): Promise<DecksResponse> => {
        return unwrapData(await apiClient.GET('/decks'), 'Failed to fetch decks');
    },

    createDeck: async (name: string): Promise<CreateDeckResponse> => {
        return unwrapData(
            await apiClient.POST('/decks', { body: { name } }),
            'Failed to create deck'
        );
    },

    saveConfig: async (config: SaveConfigPayload): Promise<SaveConfigResponse> => {
        return unwrapData(
            await apiClient.POST('/config', {
                body: config,
            }),
            'Failed to save config'
        ) as SaveConfigResponse;
    },

    clearLogs: async (): Promise<LogsClearResponse> => {
        return unwrapData(await apiClient.DELETE('/logs'), 'Failed to clear logs');
    },

    saveFile: async (
        content: string,
        suggestedFilename: string
    ): Promise<components['schemas']['SaveFileResponse']> => {
        const { data, error } = await apiClient.POST('/save-file', {
            body: {
                content,
                suggested_filename: suggestedFilename,
            },
        });
        if (error) throw new Error((error as unknown as { detail?: string }).detail || 'Failed to save file');
        return data as components['schemas']['SaveFileResponse'];
    },

    getHistory: async (): Promise<HistoryResponse> => {
        const data = unwrapData(await apiClient.GET('/history'), 'Failed to fetch history');
        return data.map((entry) => ({
            id: entry.id ?? '',
            session_id: entry.session_id ?? '',
            filename: entry.filename ?? '',
            full_path: entry.full_path ?? '',
            deck: entry.deck ?? '',
            date: entry.date ?? '',
            card_count: Number(entry.card_count ?? 0),
            status: entry.status ?? 'draft',
        }));
    },

    clearHistory: async (): Promise<HistoryClearResponse> => {
        return unwrapData(await apiClient.DELETE('/history'), 'Failed to clear history');
    },

    deleteHistoryEntry: async (id: string): Promise<HistoryDeleteResponse> => {
        return unwrapData(
            await apiClient.DELETE('/history/{entry_id}', {
                params: { path: { entry_id: id } },
            }),
            'Failed to delete entry'
        );
    },

    batchDeleteHistory: async (params: { ids?: string[]; status?: string }): Promise<HistoryBatchDeleteResponse> => {
        return unwrapData(
            await apiClient.POST('/history/batch-delete', { body: params }),
            'Failed to batch delete history'
        );
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

        // If an external signal is provided, chain it
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                controller.abort();
            });
        }

        const response = await fetch(`${API_URL}${V2_ESTIMATE_PATH}`, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error('Failed to estimate cost');
        }
        const data = (await response.json()) as Record<string, unknown>;
        return normalizeEstimation(data);
    },

    generateV2: async (req: GenerateRequest, onEvent: (event: ProgressEventV2) => void) => {
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
        if (req.session_id) {
            formData.append("session_id", req.session_id);
        }
        if (req.after_sequence_no !== undefined) {
            formData.append("after_sequence_no", String(req.after_sequence_no));
        }

        const { response } = await apiClient.POST(V2_GENERATE_PATH, {
            body: formData as unknown as components['schemas']['Body_generate_v2_generate_v2_post'],
            bodySerializer: (body) => body as unknown as FormData,
            parseAs: 'stream',
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`HTTP ${response.status}: ${errBody}`);
        }

        await parseNDJSONStreamV2(response, onEvent);
    },

    stopGeneration: async (sessionId?: string): Promise<StopResponse> => {
        const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
        const response = await fetch(`${API_URL}${V2_STOP_PATH}${query}`, {
            method: 'POST',
        });
        if (!response.ok) {
            throw new Error('Failed to stop generation');
        }
        return (await response.json()) as StopResponse;
    },

    getSession: async (sessionId: string): Promise<SessionData> => {
        const response = await fetch(`${API_URL}${V2_SESSION_PATH}/${encodeURIComponent(sessionId)}`);
        if (!response.ok) {
            throw new Error('Failed to load session');
        }
        const data = (await response.json()) as SessionData;
        return {
            ...data,
            cards: ((data.cards ?? []) as Card[]),
            logs:
                'logs' in data
                    ? (data.logs as SessionData['logs'])
                    : undefined,
            coverage_data:
                'coverage_data' in data
                    ? (data.coverage_data as CoverageData | null | undefined) ?? null
                    : null,
        } as SessionData;
    },

    syncCardsToAnki: async (
        payload: { cards: Card[]; deck_name: string; tags: string[]; slide_set_name: string; allow_updates: boolean },
        onEvent: (event: ProgressEvent) => void
    ) => {
        const { response } = await apiClient.POST('/sync', {
            body: payload as unknown as components['schemas']['SyncRequest'],
            parseAs: 'stream',
        });
        if (!response.ok) throw new Error("Sync failed");
        await parseNDJSONStream(response, onEvent);
    },

    previewSyncToAnki: async (
        payload: { cards: Card[]; deck_name: string; tags: string[]; slide_set_name: string; allow_updates: boolean }
    ): Promise<SyncPreview> => {
        const response = await fetch(`${API_URL}/sync/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Failed to preview sync (HTTP ${response.status})`);
        }
        const data = (await response.json()) as Record<string, unknown>;

        return {
            total_cards: Number(data.total_cards ?? 0),
            create_candidates: Number(data.create_candidates ?? 0),
            update_candidates: Number(data.update_candidates ?? 0),
            existing_note_matches: Number(data.existing_note_matches ?? 0),
            missing_note_ids: Number(data.missing_note_ids ?? 0),
            invalid_note_ids: Number(data.invalid_note_ids ?? 0),
            conflict_count: Number(data.conflict_count ?? 0),
            note_lookup_error:
                data.note_lookup_error == null ? null : String(data.note_lookup_error),
        };
    },

    deleteAnkiNotes: async (noteIds: number[]): Promise<AnkiNoteResponse> => {
        return unwrapData(
            await apiClient.DELETE('/anki/notes', {
                body: { note_ids: noteIds },
            }),
            'Failed to delete notes from Anki'
        );
    },

    updateAnkiNote: async (noteId: number, fields: Record<string, string>): Promise<AnkiNoteResponse> => {
        return unwrapData(
            await apiClient.PUT('/anki/notes/{note_id}', {
                params: { path: { note_id: noteId } },
                body: { fields },
            }),
            'Failed to update Anki note'
        );
    },

    getVersion: async (): Promise<Version> => {
        const data = unwrapData(await apiClient.GET('/version'), 'Failed to fetch version info');
        return { ...data, latest: data.latest ?? null };
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
