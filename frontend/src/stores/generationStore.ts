import { create } from "zustand"

export type GenerationStatus = "idle" | "loading-model" | "running" | "done" | "error"

interface GenerationStore {
  status: GenerationStatus
  statusMessage: string
  jobId: string | null
  progress: { step: number; total: number } | null
  resultImageUrl: string | null
  resultSeed: number | null
  resultDurationMs: number | null
  errorMessage: string | null

  setStatus: (status: GenerationStatus, message?: string) => void
  setJobId: (id: string) => void
  setProgress: (step: number, total: number) => void
  setDone: (imageUrl: string, seed: number, durationMs: number) => void
  setError: (message: string) => void
  reset: () => void
}

const initialState = {
  status: "idle" as GenerationStatus,
  statusMessage: "",
  jobId: null,
  progress: null,
  resultImageUrl: null,
  resultSeed: null,
  resultDurationMs: null,
  errorMessage: null,
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  ...initialState,

  setStatus: (status, message = "") => set({ status, statusMessage: message }),
  setJobId: (id) => set({ jobId: id }),
  setProgress: (step, total) => set({ progress: { step, total } }),
  setDone: (imageUrl, seed, durationMs) =>
    set({
      status: "done",
      resultImageUrl: imageUrl,
      resultSeed: seed,
      resultDurationMs: durationMs,
      progress: null,
    }),
  setError: (message) => set({ status: "error", errorMessage: message }),
  reset: () => set(initialState),
}))
