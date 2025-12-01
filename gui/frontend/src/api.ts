const API_URL = "http://localhost:8000";

export interface GenerateRequest {
    pdf_file: File;
    deck_name: string;
    model_name?: string;
    tags?: string[];
    context_deck?: string;
}

export interface ProgressEvent {
    type: "status" | "info" | "warning" | "error" | "progress_start" | "progress_update" | "card_generated" | "note_created" | "done";
    message: string;
    data?: any;
    timestamp: number;
}

export const api = {
    checkHealth: async () => {
        const res = await fetch(`${API_URL}/health`);
        return res.json();
    },

    getConfig: async () => {
        const res = await fetch(`${API_URL}/config`);
        return res.json();
    },

    getDecks: async () => {
        const res = await fetch(`${API_URL}/decks`);
        return res.json();
    },

    generate: async (req: GenerateRequest, onEvent: (event: ProgressEvent) => void) => {
        const formData = new FormData();
        formData.append("pdf_file", req.pdf_file);
        formData.append("deck_name", req.deck_name);
        if (req.model_name) formData.append("model_name", req.model_name);
        if (req.tags) formData.append("tags", JSON.stringify(req.tags));
        if (req.context_deck) formData.append("context_deck", req.context_deck);

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
};
