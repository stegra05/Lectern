import { beforeEach, describe, expect, it, vi } from 'vitest';

const openapiMocks = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('openapi-fetch', () => ({
    default: vi.fn(() => ({
        GET: openapiMocks.get,
        POST: openapiMocks.post,
        PUT: openapiMocks.put,
        DELETE: openapiMocks.delete,
    })),
}));

import { api } from '../api';

const okResponse = () => new Response('', { status: 200 });
const fetchMock = vi.fn();

describe('api v2 endpoint usage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
    });

    it('posts estimates to /estimate-v2', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                tokens: 0,
                input_tokens: 0,
                output_tokens: 0,
                input_cost: 0,
                output_cost: 0,
                cost: 0,
                pages: 0,
                model: 'gemini-3-flash',
            }),
        });

        await api.estimateCost(new File(['pdf'], 'slides.pdf', { type: 'application/pdf' }));

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/estimate-v2'),
            expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
        );
    });

    it('posts stop requests to /stop-v2', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ status: 'stopping' }),
        });

        await api.stopGeneration('session-123');

        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/stop-v2?session_id=session-123'), {
            method: 'POST',
        });
    });

    it('loads sessions from /session-v2/{session_id}', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ session_id: 'session-123', cards: [], logs: [], status: 'completed' }),
        });

        await api.getSession('session-123');

        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/session-v2/session-123'));
    });

    it('streams generation from /generate-v2 only', async () => {
        openapiMocks.post.mockResolvedValue({
            response: okResponse(),
        });

        await api.generateV2(
            {
                pdf_file: new File(['pdf'], 'slides.pdf', { type: 'application/pdf' }),
                deck_name: 'Deck',
            },
            vi.fn()
        );

        expect(openapiMocks.post).toHaveBeenCalledWith(
            '/generate-v2',
            expect.objectContaining({
                body: expect.any(FormData),
                parseAs: 'stream',
            })
        );
    });
});
