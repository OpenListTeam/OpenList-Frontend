import type Artplayer from "artplayer"
import type { JASSUBOptions } from "jassub"
import JASSUB from "jassub"
// import modernWasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url"
// import wasmUrl from "jassub/dist/wasm/jassub-worker.wasm?url"

type SubtitleSourceOption =
  | { subUrl: string; subContent?: string }
  | { subUrl?: string; subContent: string }

type ArtplayerPluginAssOptions = Omit<
  JASSUBOptions,
  "video" | "canvas" | "subUrl" | "subContent"
> &
  SubtitleSourceOption

export default function artplayerPluginAss(option: ArtplayerPluginAssOptions) {
  return (art: Artplayer) => {
    const instance = new JASSUB({
      video: art.video,
      debug: import.meta.env.DEV,
      ...option,
    } satisfies JASSUBOptions)

    instance._canvasParent?.style &&
      (instance._canvasParent.style.zIndex = "20")

    art.on("destroy", () => {
      instance.destroy()
    })

    return {
      name: "artplayerPluginAss",
      instance,
    }
  }
}
