import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

function fileToB64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read the image file"))
    r.readAsDataURL(file)
  })
}

async function describeImage(file: Blob): Promise<string> {
  const image_b64 = await fileToB64(file)
  const res = await fetch("/api/describe-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_b64 }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Image → prompt failed" }))
    throw new Error(err.detail ?? "Image → prompt failed")
  }
  return (await res.json()).prompt as string
}

/** Image → prompt: upload any image, get a text-to-image prompt describing it
 *  (free OpenRouter vision model). ~5–15s. */
export function useDescribeImage() {
  return useMutation({
    mutationFn: describeImage,
    onError: (err: Error) => toast.error(err.message),
  })
}
