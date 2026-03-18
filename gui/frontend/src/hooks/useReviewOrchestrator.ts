import { useCallback } from 'react';

import { api, type ProgressEvent, type SyncPreview } from '../api';
import {
  useDeleteAnkiNotesMutation,
  useUpdateAnkiNoteMutation,
} from '../queries';
import { useLecternStore } from '../store';
import type { LecternStore, StoreState } from '../store-types';
import { processSyncEvent } from '../logic/reviewSync';

type StoreSetter = (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void;

const setFromStore: StoreSetter = (fn) => {
  useLecternStore.setState((state) => fn(state as StoreState));
};

const getFromStore = () => useLecternStore.getState() as LecternStore;

export function useReviewOrchestrator() {
  const saveEditLocal = useLecternStore((s) => s.saveEdit);
  const handleAnkiDeleteLocal = useLecternStore((s) => s.handleAnkiDelete);
  const startSync = useLecternStore((s) => s.startSync);
  const finishSync = useLecternStore((s) => s.finishSync);
  const updateAnkiNote = useUpdateAnkiNoteMutation();
  const deleteAnkiNotes = useDeleteAnkiNotesMutation();

  const saveEdit = useCallback(async (index: number) => {
    const state = getFromStore();
    const editForm = state.editForm;
    if (!editForm) return;
    const initialEditingIndex = state.editingIndex;
    const initialEditFormRef = state.editForm;

    try {
      if (editForm.anki_note_id && editForm.fields) {
        const stringFields: Record<string, string> = {};
        for (const [k, v] of Object.entries(editForm.fields)) {
          stringFields[k] = String(v);
        }
        await updateAnkiNote.mutateAsync({
          noteId: editForm.anki_note_id,
          fields: stringFields,
        });
      }

      // Guard against stale async completion overriding a newer edit session.
      const latest = getFromStore();
      if (
        latest.editingIndex !== initialEditingIndex ||
        latest.editForm !== initialEditFormRef ||
        latest.editingIndex !== index
      ) {
        return;
      }
      saveEditLocal(index);
    } catch (error) {
      console.error('Failed to update card', error);
      getFromStore().addToast('error', 'Failed to update card');
    }
  }, [saveEditLocal, updateAnkiNote]);

  const handleAnkiDelete = useCallback(async (noteId: number, index: number) => {
    try {
      await deleteAnkiNotes.mutateAsync([noteId]);
      handleAnkiDeleteLocal(noteId, index);
      getFromStore().addToast('warning', 'Note deleted from Anki');
    } catch (error) {
      console.error('Failed to delete Anki note', error);
      getFromStore().addToast('error', 'Failed to delete from Anki');
    }
  }, [deleteAnkiNotes, handleAnkiDeleteLocal]);

  const handleSync = useCallback(async () => {
    const { cards, deckName } = getFromStore();
    startSync();
    try {
      await api.syncCardsToAnki(
        {
          cards,
          deck_name: deckName,
          tags: [],
          slide_set_name: deckName,
          allow_updates: true,
        },
        (event: ProgressEvent) => processSyncEvent(event, setFromStore, getFromStore)
      );
    } catch (error) {
      console.error('Sync failed', error);
      getFromStore().addToast('error', 'Sync failed');
    } finally {
      finishSync();
    }
  }, [finishSync, startSync]);

  const handleSyncPreview = useCallback(async (): Promise<SyncPreview | null> => {
    const { cards, deckName } = getFromStore();
    try {
      return await api.previewSyncToAnki({
        cards,
        deck_name: deckName,
        tags: [],
        slide_set_name: deckName,
        allow_updates: true,
      });
    } catch (error) {
      console.error('Sync preview failed', error);
      getFromStore().addToast('error', 'Failed to preview sync');
      return null;
    }
  }, []);

  return {
    saveEdit,
    handleAnkiDelete,
    handleSync,
    handleSyncPreview,
  };
}
