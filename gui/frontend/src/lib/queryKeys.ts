/**
 * Centralized query key factory for React Query.
 * Following best practices for query key structure.
 */

export const queryKeys = {
  // Health status - polled frequently
  health: ['health'] as const,

  // Anki connection status
  ankiStatus: ['ankiStatus'] as const,

  // Configuration
  config: ['config'] as const,

  // Deck list
  decks: ['decks'] as const,

  // History entries
  history: ['history'] as const,

  // Version info
  version: ['version'] as const,
} as const;
