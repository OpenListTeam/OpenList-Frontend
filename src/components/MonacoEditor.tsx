import { Box } from "@hope-ui/solid"
import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { MaybeLoading } from "./FullLoading"
import loader from "@monaco-editor/loader"
import { useCDN } from "~/hooks"
import type * as monacoType from "monaco-editor/esm/vs/editor/editor.api.js"
import { local } from "~/store"

export interface MonacoEditorProps {
  value: string
  onChange?: (value: string) => void
  path?: string
  language?: string
  options?: monacoType.editor.IStandaloneEditorConstructionOptions
  onEditorReady?: (editor: monacoType.editor.IStandaloneCodeEditor) => void
}
export let monaco: typeof monacoType

export const MonacoEditorLoader = (props: MonacoEditorProps) => {
  const { monacoPath } = useCDN()
  const [loading, setLoading] = createSignal(true)
  loader.config({
    paths: {
      vs: monacoPath(),
    },
  })
  loader.init().then((m) => {
    monaco = m
    setLoading(false)
  })
  return (
    <MaybeLoading loading={loading()}>
      <MonacoEditor {...props} />
    </MaybeLoading>
  )
}

export const MonacoEditor = (props: MonacoEditorProps) => {
  let monacoEditorDiv: HTMLDivElement
  let monacoEditor: monacoType.editor.IStandaloneCodeEditor
  let model: monacoType.editor.ITextModel

  onMount(() => {
    const constructionOptions = {
      ...props.options,
      value: props.value,
      fontSize: parseInt(local.editor_font_size),
      automaticLayout: true,
    }
    monacoEditor = monaco.editor.create(monacoEditorDiv!, constructionOptions)
    model = monaco.editor.createModel(
      props.value,
      props.language,
      props.path ? monaco.Uri.parse(props.path) : undefined,
    )
    monacoEditor.setModel(model)
    monacoEditor.onDidChangeModelContent(() => {
      props.onChange?.(monacoEditor.getValue())
    })
    props.onEditorReady?.(monacoEditor)
  })
  createEffect(
    on(
      () => props.value,
      (value) => {
        monacoEditor.setValue(value)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    monaco.editor.setTheme(props.options?.theme ?? "vs")
  })

  createEffect(
    on(
      () => props.language,
      (lang) => {
        if (lang && model) {
          monaco.editor.setModelLanguage(model, lang)
        }
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    monacoEditor?.updateOptions({
      fontSize: parseInt(local.editor_font_size),
      ...props.options,
    })
  })

  onCleanup(() => {
    model && model.dispose()
    monacoEditor && monacoEditor.dispose()
  })
  return <Box w="$full" flex={1} minH="60vh" ref={monacoEditorDiv!} />
}
