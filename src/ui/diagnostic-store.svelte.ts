import type { Overview, Result } from '../domain/types';

type StoreState = {
  origin: string | null;
  overview: Overview | null;
  loading: boolean;
  error: string | null;
};

export function createDiagnosticStore(loadOverview: () => Promise<Result<Overview>>) {
  let generation = 0;
  const state: StoreState = { origin: null, overview: null, loading: false, error: null };

  return {
    state,
    resetForNavigation(origin: string) {
      generation += 1;
      state.origin = origin;
      state.overview = null;
      state.loading = false;
      state.error = null;
    },
    async refresh() {
      const requestGeneration = generation;
      state.loading = true;
      state.error = null;
      const result = await loadOverview();
      if (requestGeneration !== generation) return;
      state.loading = false;
      if (!result.ok) {
        state.overview = null;
        state.error = result.error.message;
        return;
      }
      state.origin = result.value.origin;
      state.overview = result.value;
    },
  };
}
