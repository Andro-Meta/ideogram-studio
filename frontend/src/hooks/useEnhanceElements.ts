import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { usePromptStore } from "@/stores/promptStore"

interface EnhanceResponse {
  descs: string[]
}

/**
 * Enrich every element's description via the LLM while preserving the layout.
 * Only the descriptions are sent and returned — bboxes, types, and rendered
 * text never leave the client, so the composition is structurally guaranteed
 * to survive. (Community-requested workflow: lay out boxes simply, then let the
 * model flesh out the detail.)
 */
export function useEnhanceElements() {
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const s = usePromptStore.getState()
      // Snapshot id + fields up front so we can splice back by id even if the
      // list changes during the call.
      const snapshot = s.elements.map((e) => ({
        id: e.id,
        type: e.type,
        text: "text" in e ? (e.text ?? "") : "",
        desc: e.desc ?? "",
      }))
      if (snapshot.length === 0) throw new Error("Add some elements first")

      const res = await fetch("/api/enhance-elements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          high_level_description: s.high_level_description,
          elements: snapshot.map(({ type, text, desc }) => ({ type, text, desc })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Enhance failed" }))
        throw new Error(err.detail ?? "Enhance failed")
      }
      const data = (await res.json()) as EnhanceResponse

      // Splice the enriched descriptions back by id — never touch bbox/type/text.
      const update = usePromptStore.getState().updateElement
      let applied = 0
      data.descs.forEach((desc, i) => {
        const el = snapshot[i]
        if (el && desc) {
          update(el.id, { desc })
          applied++
        }
      })
      return applied
    },
    onSuccess: (n) =>
      toast.success(`Enhanced ${n} description${n === 1 ? "" : "s"} — layout kept`),
    onError: (e: Error) => toast.error(e.message),
  })
}
