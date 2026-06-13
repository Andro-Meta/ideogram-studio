import { create } from "zustand"
import type { AnyElement, PromptState, StyleDescription, StyleMode } from "@/types/caption"
import { defaultPromptState } from "@/types/caption"
import { uid } from "@/lib/uid"

// uid() works over plain HTTP on the LAN (crypto.randomUUID does not).
function newId(): string {
  return uid()
}

interface PromptStore extends PromptState {
  setHighLevelDescription: (v: string) => void
  setBackground: (v: string) => void
  setStyleField: <K extends keyof StyleDescription>(key: K, value: StyleDescription[K]) => void
  setStyleMode: (mode: StyleMode) => void
  addElement: (type: "obj" | "text") => void
  updateElement: (id: string, patch: Partial<AnyElement>) => void
  removeElement: (id: string) => void
  reorderElements: (from: number, to: number) => void
  loadFromParsed: (state: Partial<PromptState>) => void
  reset: () => void
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  ...defaultPromptState(),

  setHighLevelDescription: (v) => set({ high_level_description: v }),
  setBackground: (v) => set({ background: v }),

  setStyleField: (key, value) =>
    set((s) => ({
      style_description: { ...s.style_description, [key]: value },
    })),

  setStyleMode: (mode) =>
    set((s) => ({
      style_description: { ...s.style_description, mode },
    })),

  addElement: (type) =>
    set((s) => {
      const newEl: AnyElement =
        type === "text"
          ? { id: newId(), type: "text", text: "", desc: "", color_palette: [] }
          : { id: newId(), type: "obj",  desc: "", color_palette: [] }
      return { elements: [...s.elements, newEl] }
    }),

  updateElement: (id, patch) =>
    set((s) => ({
      elements: s.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as AnyElement) : el
      ),
    })),

  removeElement: (id) =>
    set((s) => ({ elements: s.elements.filter((el) => el.id !== id) })),

  reorderElements: (from, to) =>
    set((s) => {
      const arr = [...s.elements]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return { elements: arr }
    }),

  loadFromParsed: (parsed) =>
    set((s) => ({
      high_level_description: parsed.high_level_description ?? s.high_level_description,
      style_description:      parsed.style_description      ?? s.style_description,
      background:             parsed.background             ?? s.background,
      elements:               parsed.elements               ?? s.elements,
    })),

  reset: () => set(defaultPromptState()),
}))
