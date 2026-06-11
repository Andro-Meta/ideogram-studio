import { StyleLibrary } from "./StyleLibrary"
import { StyleForm } from "./StyleForm"

/** Style section body: preset library on top, unified fields below.
 *  The section title comes from the FlowSection wrapper in Generate. */
export function StylePanel() {
  return (
    <div className="space-y-3">
      <StyleLibrary />
      <StyleForm />
    </div>
  )
}
