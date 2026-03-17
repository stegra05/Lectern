import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { queryKeys } from '../lib/queryKeys';

interface DecksResponse {
  decks: string[];
}

/**
 * Hook for fetching deck list from Anki.
 */
export function useDecksQuery() {
  return useQuery<DecksResponse>({
    queryKey: queryKeys.decks,
    queryFn: api.getDecks,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook for creating a new deck.
 * Invalidates decks query on success.
 */
export function useCreateDeckMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => api.createDeck(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.decks });
    },
  });
}
