import { useQuery } from '@tanstack/react-query';

import { api, type Estimation } from '../api';

type EstimationQueryContext = {
  file: File | null;
  modelName?: string;
};

export function useEstimationQuery({ file, modelName }: EstimationQueryContext) {
  return useQuery<Estimation>({
    queryKey: ['estimate', file?.name, file?.size, file?.lastModified, modelName ?? ''],
    enabled: Boolean(file),
    retry: 1,
    queryFn: ({ signal }) => api.estimateCost(file as File, modelName, undefined, signal),
    staleTime: 1000 * 60 * 5,
  });
}
