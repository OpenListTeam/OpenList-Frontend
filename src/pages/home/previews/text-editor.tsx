import {
  Box,
  Button,
  HStack,
  IconButton,
  useColorMode,
  VStack,
} from "@hope-ui/solid"
import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { EncodingSelect, MaybeLoading } from "~/components"
import { MonacoEditorLoader } from "~/components/MonacoEditor"
import { useFetch, useFetchText, useParseText, useRouter, useT } from "~/hooks"
import { objStore, setLocal, userCan } from "~/store"
import { local } from "~/store"
import { PEmptyResp } from "~/types"
import { handleResp, notify, r } from "~/utils"
import { createShortcut } from "@solid-primitives/keyboard"
import { BiRegularRedo, BiRegularUndo } from "solid-icons/bi"
import { TbDeviceFloppy, TbTextWrap, TbTextWrapDisabled } from "solid-icons/tb"
import { FaSolidMinus, FaSolidPlus } from "solid-icons/fa"
import { AiOutlineFullscreen, AiOutlineFullscreenExit } from "solid-icons/ai"
import type * as monacoType from "monaco-editor/esm/vs/editor/editor.api.js"

function Editor(props: { data?: string | ArrayBuffer; contentType?: string }) {
  const { colorMode } = useColorMode()
  const theme = createMemo(() => {
    return colorMode() === "light" ? "vs" : "vs-dark"
  })
  const { pathname } = useRouter()
  const { isString, text } = useParseText(props.data)
  const [encoding, setEncoding] = createSignal("utf-8")
  const [value, setValue] = createSignal(text(encoding()))
  const t = useT()

  // Editor instance reference
  const [editor, setEditor] =
    createSignal<monacoType.editor.IStandaloneCodeEditor>()

  // Track modified state
  const [modified, setModified] = createSignal(false)
  const [cursorLine, setCursorLine] = createSignal(1)
  const [cursorColumn, setCursorColumn] = createSignal(1)
  const [wordCount, setWordCount] = createSignal(0)
  const [language, setLanguage] = createSignal("")
  const [wordWrap, setWordWrap] = createSignal(false)
  const [fullscreen, setFullscreen] = createSignal(false)

  // Save on Ctrl+S / Cmd+S
  createShortcut(["Control", "S"], (e: KeyboardEvent | null) => {
    e?.preventDefault()
    onSave()
  })
  createShortcut(["Meta", "S"], (e: KeyboardEvent | null) => {
    e?.preventDefault()
    onSave()
  })
  // Escape to exit fullscreen
  createShortcut(["Escape"], () => {
    if (fullscreen()) setFullscreen(false)
  })

  const [loading, save] = useFetch(
    (): PEmptyResp =>
      r.put("/fs/put", value(), {
        headers: {
          "File-Path": encodeURIComponent(pathname()),
          "Content-Type": props.contentType || "text/plain",
        },
      }),
  )

  createEffect(
    on(encoding, (v) => {
      setValue(text(v))
      setModified(false)
    }),
  )

  async function onSave() {
    const resp = await save()
    handleResp(resp, () => {
      notify.success(t("global.save_success"))
      setModified(false)
    })
  }

  function onEditorReady(ed: monacoType.editor.IStandaloneCodeEditor) {
    setEditor(ed)

    // Track cursor position
    ed.onDidChangeCursorPosition((e) => {
      setCursorLine(e.position.lineNumber)
      setCursorColumn(e.position.column)
    })

    // Track content changes for modified state
    let savedVersionId = ed.getModel()?.getAlternativeVersionId() ?? 0
    ed.onDidChangeModelContent(() => {
      const currentVersionId = ed.getModel()?.getAlternativeVersionId() ?? 0
      setModified(currentVersionId !== savedVersionId)
      updateWordCount(ed)
    })

    // Initial word count
    updateWordCount(ed)

    // Detect language from model
    const lang = ed.getModel()?.getLanguageId() ?? ""
    setLanguage(lang)
  }

  function updateWordCount(ed: monacoType.editor.IStandaloneCodeEditor) {
    const content = ed.getValue()
    if (!content) {
      setWordCount(0)
      return
    }
    const trimmed = content.trim()
    setWordCount(trimmed ? trimmed.split(/\s+/).length : 0)
  }

  function undo() {
    editor()?.trigger("toolbar", "undo", null)
  }

  function redo() {
    editor()?.trigger("toolbar", "redo", null)
  }

  function toggleWordWrap() {
    const next = !wordWrap()
    setWordWrap(next)
    editor()?.updateOptions({ wordWrap: next ? "on" : "off" })
  }

  function changeFontSize(delta: number) {
    const current = parseInt(local.editor_font_size) || 14
    const next = Math.max(8, Math.min(40, current + delta))
    setLocal("editor_font_size", String(next))
  }

  return (
    <VStack
      w="$full"
      alignItems="stretch"
      spacing={0}
      pos={fullscreen() ? "fixed" : "relative"}
      top={0}
      left={0}
      zIndex={fullscreen() ? "$overlay" : undefined}
      bg={colorMode() === "light" ? "$neutral1" : "$neutral2"}
      h={fullscreen() ? "100vh" : undefined}
    >
      {/* Toolbar */}
      <HStack
        px="$3"
        py="$1_5"
        spacing="$1"
        borderBottom="1px solid"
        borderColor={colorMode() === "light" ? "$neutral4" : "$neutral3"}
        bg={colorMode() === "light" ? "$neutral2" : "$neutral1"}
        overflowX="auto"
        flexShrink={0}
      >
        <Show
          when={
            objStore.write &&
            (userCan("write_content") || objStore.write_content_bypass)
          }
        >
          <Button
            size="sm"
            loading={loading()}
            onClick={onSave}
            leftIcon={<TbDeviceFloppy />}
          >
            {t("global.save")}
            <Show when={modified()}>
              <Box
                as="span"
                ml="$1"
                display="inline-block"
                w="8px"
                h="8px"
                borderRadius="$full"
                bg="$warning9"
                verticalAlign="middle"
              />
            </Show>
          </Button>
        </Show>

        <IconButton
          aria-label={t("global.undo")}
          icon={<BiRegularUndo />}
          size="sm"
          variant="ghost"
          onClick={undo}
          title={`${t("global.undo")} (Ctrl+Z)`}
        />
        <IconButton
          aria-label={t("global.redo")}
          icon={<BiRegularRedo />}
          size="sm"
          variant="ghost"
          onClick={redo}
          title={`${t("global.redo")} (Ctrl+Y)`}
        />

        <Box
          w="1px"
          h="$5"
          bg={colorMode() === "light" ? "$neutral6" : "$neutral4"}
          mx="$1"
        />

        <IconButton
          aria-label={t("global.wrap")}
          icon={wordWrap() ? <TbTextWrap /> : <TbTextWrapDisabled />}
          size="sm"
          variant="ghost"
          onClick={toggleWordWrap}
          title={t("global.wrap")}
          color={wordWrap() ? "$info11" : undefined}
        />

        <HStack spacing={0}>
          <IconButton
            aria-label={t("global.font_size")}
            icon={<FaSolidMinus />}
            size="sm"
            variant="ghost"
            onClick={() => changeFontSize(-1)}
            title={t("global.font_size")}
          />
          <Box
            fontSize="$xs"
            color="$neutral11"
            minW="28px"
            textAlign="center"
            userSelect="none"
          >
            {local.editor_font_size}
          </Box>
          <IconButton
            aria-label={t("global.font_size")}
            icon={<FaSolidPlus />}
            size="sm"
            variant="ghost"
            onClick={() => changeFontSize(1)}
            title={t("global.font_size")}
          />
        </HStack>

        <Box
          w="1px"
          h="$5"
          bg={colorMode() === "light" ? "$neutral6" : "$neutral4"}
          mx="$1"
        />

        <IconButton
          aria-label="Fullscreen"
          icon={
            fullscreen() ? <AiOutlineFullscreenExit /> : <AiOutlineFullscreen />
          }
          size="sm"
          variant="ghost"
          onClick={() => setFullscreen(!fullscreen())}
          title="Fullscreen (Esc)"
          color={fullscreen() ? "$info11" : undefined}
        />

        <Show when={!isString}>
          <Box w="$28">
            <EncodingSelect
              encoding={encoding()}
              setEncoding={setEncoding}
              referenceText={props.data}
            />
          </Box>
        </Show>
      </HStack>

      {/* Editor */}
      <MonacoEditorLoader
        value={text(encoding())}
        theme={theme()}
        path={objStore.obj.name}
        onChange={(val) => setValue(val)}
        onEditorReady={onEditorReady}
      />

      {/* Status Bar */}
      <HStack
        px="$3"
        py="$1"
        spacing="$3"
        borderTop="1px solid"
        borderColor={colorMode() === "light" ? "$neutral4" : "$neutral3"}
        bg={colorMode() === "light" ? "$neutral2" : "$neutral1"}
        fontSize="$xs"
        color="$neutral11"
        flexShrink={0}
      >
        <Box style={{ "white-space": "nowrap" }}>
          Ln {cursorLine()}, Col {cursorColumn()}
        </Box>
        <Box style={{ "white-space": "nowrap" }}>{wordCount()} words</Box>
        <Box flex="1" />
        <Show when={language()}>
          <Box style={{ "white-space": "nowrap" }}>{language()}</Box>
        </Show>
        <Box style={{ "white-space": "nowrap" }}>{encoding()}</Box>
        <Show when={modified()}>
          <Box color="$warning11" style={{ "white-space": "nowrap" }}>
            ● {t("global.modified")}
          </Box>
        </Show>
      </HStack>
    </VStack>
  )
}

const TextEditor = () => {
  const [content] = useFetchText()
  return (
    <MaybeLoading loading={content.loading}>
      <Editor data={content()?.content} contentType={content()?.contentType} />
    </MaybeLoading>
  )
}

export default TextEditor
