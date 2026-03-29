// React Query hooks for static server state
export { useHealthQuery, type HealthStatus } from './useHealthQuery';
export { useConfigQuery, useSaveConfigMutation, useClearLogsMutation } from './useConfigQuery';
export type { Config, SaveConfigPayload } from '../schemas/api';
export { useDecksQuery, useCreateDeckMutation } from './useDecksQuery';
export { useHistoryQuery, useDeleteHistoryMutation, useClearHistoryMutation, useBatchDeleteHistoryMutation, type HistoryEntry } from './useHistoryQuery';
export { useAnkiStatusQuery } from './useAnkiStatusQuery';
export { useDeleteAnkiNotesMutation, useUpdateAnkiNoteMutation } from './useAnkiNoteMutations';
export { useEstimationQuery } from './useEstimationQuery';
export { useVersionQuery, type VersionInfo } from './useVersionQuery';
