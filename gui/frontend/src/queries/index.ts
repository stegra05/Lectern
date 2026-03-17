// React Query hooks for static server state
export { useHealthQuery, type HealthStatus } from './useHealthQuery';
export { useConfigQuery, useSaveConfigMutation, type SaveConfigPayload } from './useConfigQuery';
export type { Config } from '../schemas/api';
export { useDecksQuery, useCreateDeckMutation } from './useDecksQuery';
export { useHistoryQuery, useDeleteHistoryMutation, useClearHistoryMutation, useBatchDeleteHistoryMutation, type HistoryEntry } from './useHistoryQuery';
export { useAnkiStatusQuery } from './useAnkiStatusQuery';
export { useVersionQuery, type VersionInfo } from './useVersionQuery';
