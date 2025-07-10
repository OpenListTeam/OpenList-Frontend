import { Box } from "@hope-ui/solid"
import { createEffect, onCleanup, onMount, splitProps } from "solid-js"
import * as monaco from "monaco-editor"

// Configure worker for Monaco Editor
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") {
      return new jsonWorker()
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker()
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker()
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker()
    }
    return new editorWorker()
  },
}
export interface MonacoEditorProps
  extends monaco.editor.IStandaloneEditorConstructionOptions {
  value: string
  onChange?: (value: string) => void
  theme?: "vs" | "vs-dark" | "hc-black" | "hc-light"
  path?: string
  language?: string
}

export const MonacoEditor = (props: MonacoEditorProps) => {
  let monacoEditorDiv: HTMLDivElement
  let monacoEditor: monaco.editor.IStandaloneCodeEditor
  let model: monaco.editor.ITextModel

  // Separate custom properties and Monaco options
  const [customProps, monacoOptions] = splitProps(props, ["onChange", "path"])

  onMount(() => {
    monacoEditor = monaco.editor.create(monacoEditorDiv!, {
      automaticLayout: true,
      ...monacoOptions,
    })

    model = monaco.editor.createModel(
      props.value,
      props.language,
      customProps.path ? monaco.Uri.parse(customProps.path) : undefined,
    )
    monacoEditor.setModel(model)

    monacoEditor.onDidChangeModelContent(() => {
      customProps.onChange?.(monacoEditor.getValue())
    })
  })

  createEffect(() => {
    if (monacoEditor && props.value !== monacoEditor.getValue()) {
      monacoEditor.setValue(props.value)
    }
  })

  createEffect(() => {
    if (monacoEditor && props.theme) {
      monaco.editor.setTheme(props.theme)
    }
  })

  onCleanup(() => {
    model?.dispose()
    monacoEditor?.dispose()
  })

  return <Box w="$full" h="70vh" ref={monacoEditorDiv!} />
}
