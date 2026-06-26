import {
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  useColorMode,
  VStack,
} from "@hope-ui/solid"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js"
import { useBeforeLeave } from "@solidjs/router"
import { EncodingSelect, MaybeLoading } from "~/components"
import { MonacoEditorLoader, monaco } from "~/components/MonacoEditor"
import { useFetchText, useParseText, useRouter, useT } from "~/hooks"
import { objStore, setLocal } from "~/store"
import { local } from "~/store"
import { notify } from "~/utils"
import { StreamUpload } from "~/pages/home/uploads/stream"
import { createShortcut } from "@solid-primitives/keyboard"
import { BiRegularRedo, BiRegularUndo } from "solid-icons/bi"
import {
  TbBraces,
  TbDeviceFloppy,
  TbTextWrap,
  TbTextWrapDisabled,
  TbMap,
  TbMapOff,
} from "solid-icons/tb"
import { FaSolidMinus, FaSolidPlus } from "solid-icons/fa"
import { AiOutlineFullscreen, AiOutlineFullscreenExit } from "solid-icons/ai"
import type * as monacoType from "monaco-editor/esm/vs/editor/editor.api.js"

interface LanguageOption {
  id: string
  aliases?: string[]
}

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
  const [languageOptions, setLanguageOptions] = createSignal<LanguageOption[]>(
    [],
  )
  const [wordWrap, setWordWrap] = createSignal(false)
  const [minimap, setMinimap] = createSignal(true)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [langSearch, setLangSearch] = createSignal("")
  const filteredLanguages = createMemo(() => {
    const s = langSearch().toLowerCase()
    if (!s) return languageOptions()
    return languageOptions().filter(
      (l) =>
        l.id.toLowerCase().includes(s) ||
        l.aliases?.some((a) => a.toLowerCase().includes(s)),
    )
  })
  const languageDisplayName = createMemo(() => {
    const lang = languageOptions().find((l) => l.id === language())
    return lang?.aliases?.[0] || language()
  })

  // Warn on browser close/refresh when there are unsaved changes
  const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (modified()) {
      e.preventDefault()
    }
  }
  window.addEventListener("beforeunload", beforeUnloadHandler)
  onCleanup(() =>
    window.removeEventListener("beforeunload", beforeUnloadHandler),
  )

  // Warn on in-app navigation when there are unsaved changes
  useBeforeLeave((e) => {
    if (modified()) {
      if (!window.confirm(t("global.unsaved_changes_confirm"))) {
        e.preventDefault()
      }
    }
  })

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

  createEffect(
    on(encoding, (v) => {
      setValue(text(v))
      setModified(false)
    }),
  )

  async function onSave() {
    setSaving(true)
    try {
      const file = new File([value()], objStore.obj.name, {
        type: props.contentType || "text/plain",
      })
      await StreamUpload(pathname(), file, () => {}, false, true, false)
      notify.success(t("global.save_success"))
      setModified(false)
    } catch (e: any) {
      notify.error(e.message)
    } finally {
      setSaving(false)
    }
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

    // Populate language options from Monaco
    if (monaco?.languages?.getLanguages) {
      const langs = monaco.languages.getLanguages() as LanguageOption[]
      setLanguageOptions(langs.sort((a, b) => a.id.localeCompare(b.id)))
    }
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
    setWordWrap(!wordWrap())
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
        <Button
          size="sm"
          colorScheme={modified() ? "info" : "neutral"}
          loading={saving()}
          onClick={onSave}
          leftIcon={<TbDeviceFloppy />}
        >
          {t("global.save")}
        </Button>

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

        <Box w="1px" h="$5" bg="$neutral4" mx="$1" />

        <IconButton
          aria-label={t("global.wrap")}
          icon={wordWrap() ? <TbTextWrap /> : <TbTextWrapDisabled />}
          size="sm"
          variant="ghost"
          onClick={toggleWordWrap}
          title={t("global.wrap")}
          color={wordWrap() ? "$info11" : undefined}
        />

        <IconButton
          aria-label="Minimap"
          icon={minimap() ? <TbMap /> : <TbMapOff />}
          size="sm"
          variant="ghost"
          onClick={() => setMinimap(!minimap())}
          title="Minimap"
          color={minimap() ? "$info11" : undefined}
        />

        <Box w="1px" h="$5" bg="$neutral4" mx="$1" />

        <HStack spacing={0} display={{ "@initial": "none", "@sm": "flex" }}>
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
        language={language()}
        path={objStore.obj.name}
        options={{
          theme: theme(),
          wordWrap: wordWrap() ? "on" : "off",
          minimap: { enabled: minimap() },
        }}
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
        <Show when={modified()}>
          <Box color="$warning11" style={{ "white-space": "nowrap" }}>
            ●
          </Box>
        </Show>
        <Box style={{ "white-space": "nowrap" }}>
          Ln {cursorLine()}, Col {cursorColumn()}
        </Box>
        <Box style={{ "white-space": "nowrap" }}>{wordCount()} words</Box>
        <Box flex="1" />
        <Show when={language()}>
          <Popover placement="top-end" onClose={() => setLangSearch("")}>
            <PopoverTrigger
              as={Box}
              style={{ "white-space": "nowrap", cursor: "pointer" }}
              px="$1"
              borderRadius="$sm"
              _hover={{
                bg: "$neutral4",
              }}
            >
              <HStack spacing="$1">
                <TbBraces size={13} />
                <Box>{languageDisplayName()}</Box>
              </HStack>
            </PopoverTrigger>
            <PopoverContent w="280px" maxH="350px" borderRadius="$lg">
              <PopoverBody p="$2">
                <Input
                  size="xs"
                  placeholder="Search language..."
                  value={langSearch()}
                  onInput={(e) => setLangSearch(e.currentTarget.value)}
                  mb="$2"
                  autofocus
                />
                <VStack
                  spacing={0}
                  maxH="280px"
                  overflowY="auto"
                  alignItems="stretch"
                >
                  <For each={filteredLanguages()}>
                    {(lang) => (
                      <Box
                        px="$2"
                        py="$1_5"
                        fontSize="$xs"
                        borderRadius="$sm"
                        cursor="pointer"
                        bg={language() === lang.id ? "$info4" : "transparent"}
                        _hover={{
                          bg: "$neutral4",
                        }}
                        onClick={() => {
                          setLanguage(lang.id)
                          setLangSearch("")
                        }}
                      >
                        {lang.aliases?.[0] || lang.id}
                        <Show when={lang.aliases?.[0]}>
                          <Box
                            as="span"
                            color="$neutral9"
                            fontSize="$2xs"
                            ml="$1"
                          >
                            ({lang.id})
                          </Box>
                        </Show>
                      </Box>
                    )}
                  </For>
                </VStack>
              </PopoverBody>
            </PopoverContent>
          </Popover>
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
