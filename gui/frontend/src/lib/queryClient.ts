import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      gcTime: 1000 * 60 * 5, // 5 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 1,
    },
  },
});
