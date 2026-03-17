import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { queryKeys } from '../lib/queryKeys';

export function useDeleteAnkiNotesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteIds: number[]) => api.deleteAnkiNotes(noteIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ankiStatus });
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}

export function useUpdateAnkiNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, fields }: { noteId: number; fields: Record<string, string> }) =>
      api.updateAnkiNote(noteId, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}
