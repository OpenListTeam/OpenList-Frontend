import {
  Box,
  Button,
  ButtonGroup,
  HStack,
  IconButton,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  useColorMode,
  VStack,
} from "@hope-ui/solid"
import { createShortcut } from "@solid-primitives/keyboard"
import { useBeforeLeave } from "@solidjs/router"
import type * as monacoType from "monaco-editor/esm/vs/editor/editor.api.js"
import { BiRegularRedo, BiRegularUndo } from "solid-icons/bi"
import { FaSolidMinus, FaSolidPlus } from "solid-icons/fa"
import {
  TbBraces,
  TbClipboardText,
  TbCopy,
  TbDeviceFloppy,
  TbMap,
  TbMapOff,
  TbTextWrap,
  TbTextWrapDisabled,
} from "solid-icons/tb"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { BoxWithFullScreen, EncodingSelect, MaybeLoading } from "~/components"
import { monaco, MonacoEditorLoader } from "~/components/MonacoEditor"
import { useFetchText, useParseText, useRouter, useT, useUtil } from "~/hooks"
import { StreamUpload } from "~/pages/home/uploads/stream"
import { local, objStore, setLocal, userCan } from "~/store"
import { notify } from "~/utils"

interface LanguageOption {
  id: string
  aliases?: string[]
}

function Editor(props: { data?: string | ArrayBuffer; contentType?: string }) {
  const { colorMode } = useColorMode()
  const theme = createMemo(() => (colorMode() === "light" ? "vs" : "vs-dark"))
  const { pathname } = useRouter()
  const { isString, text } = useParseText(props.data)
  const [encoding, setEncoding] = createSignal("utf-8")
  const [value, setValue] = createSignal(text(encoding()))
  const t = useT()
  const { copy, paste } = useUtil()

  // Editor instance reference
  const [editor, setEditor] =
    createSignal<monacoType.editor.IStandaloneCodeEditor>()
  let savedVersionId = 0

  // Track modified state
  const [modified, setModified] = createSignal(false)
  const [cursorLine, setCursorLine] = createSignal(1)
  const [cursorColumn, setCursorColumn] = createSignal(1)
  const [wordCount, setWordCount] = createSignal(0)
  const [language, setLanguage] = createSignal("")
  const [languageOptions, setLanguageOptions] = createSignal<LanguageOption[]>(
    [],
  )

  const wordWrap = () => local.editor_word_wrap === "true"
  const minimap = () => local.editor_minimap !== "false"
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

  const canWrite = createMemo(
    () =>
      // objStore.write is only set from folder listing (FsListResp),
      // not from file detail (FsGetResp). When directly entering a file,
      // write is undefined, so fall back to permission check only.
      (userCan("write_content") || objStore.write_content_bypass) &&
      objStore.write !== false,
  )

  // Warn on in-app navigation when there are unsaved changes
  useBeforeLeave((e) => {
    if (canWrite() && modified()) {
      if (!window.confirm(t("global.unsaved_changes_confirm"))) {
        e.preventDefault()
      }
    }
  })

  onMount(() => {
    if (canWrite()) {
      // Save on Ctrl+S / Cmd+S
      createShortcut(["Control", "S"], (e: KeyboardEvent | null) => {
        e?.preventDefault()
        onSave()
      })
      createShortcut(["Meta", "S"], (e: KeyboardEvent | null) => {
        e?.preventDefault()
        onSave()
      })

      // Warn on browser close/refresh when there are unsaved changes
      const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
        if (modified()) {
          e.preventDefault()
        }
      }
      window.addEventListener("beforeunload", beforeUnloadHandler)

      onCleanup(() => {
        window.removeEventListener("beforeunload", beforeUnloadHandler)
      })
    }
  })

  createEffect(
    on(encoding, (v) => {
      setValue(text(v))
      setModified(false)
    }),
  )

  async function onSave() {
    const ed = editor()
    if (saving() || !ed) return

    const savedVersion = ed.getModel()?.getAlternativeVersionId() ?? 0
    setSaving(true)
    try {
      const file = new File([value()], objStore.obj.name, {
        type: props.contentType || "text/plain",
      })
      await StreamUpload(pathname(), file, () => {}, false, true, false)
      savedVersionId = savedVersion
      setModified(
        (ed.getModel()?.getAlternativeVersionId() ?? 0) !== savedVersionId,
      )
      notify.success(t("global.save_success"))
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
    savedVersionId = ed.getModel()?.getAlternativeVersionId() ?? 0
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

  async function copyToClipboard() {
    const ed = editor()
    if (!ed) return
    const sel = ed.getSelection()
    const selection = sel ? (ed.getModel()?.getValueInRange(sel) ?? "") : ""
    const text = selection || ed.getValue()
    await copy(text)
  }

  async function pasteFromClipboard() {
    const ed = editor()
    if (!ed) return

    const text = await paste()
    if (!text) return
    const selection = ed.getSelection()
    if (selection) {
      ed.executeEdits("paste", [
        { range: selection, text, forceMoveMarkers: true },
      ])
    } else {
      ed.trigger("keyboard", "paste", { text })
    }
    ed.focus()
  }

  function toggleWordWrap() {
    setLocal("editor_word_wrap", String(!wordWrap()))
  }

  function changeFontSize(delta: number) {
    const current = parseInt(local.editor_font_size) || 14
    const next = Math.max(8, Math.min(40, current + delta))
    setLocal("editor_font_size", String(next))
  }

  return (
    <VStack
      w="$full"
      h="$full"
      alignItems="stretch"
      spacing={0}
      top={0}
      left={0}
      bg={colorMode() === "light" ? "$neutral1" : "$neutral2"}
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
        <Show when={canWrite()}>
          <Tooltip label={`${t("global.save")} (Ctrl+S)`} withArrow>
            <Button
              aria-label={t("global.save")}
              disabled={!modified() || saving()}
              leftIcon={<TbDeviceFloppy />}
              size="sm"
              variant="solid"
              loading={saving()}
              onClick={onSave}
            >
              {t("global.save")}
            </Button>
          </Tooltip>

          <Tooltip label={`${t("global.undo")} (Ctrl+Z)`} withArrow>
            <IconButton
              aria-label={t("global.undo")}
              icon={<BiRegularUndo />}
              size="sm"
              variant="ghost"
              onClick={undo}
            />
          </Tooltip>
          <Tooltip label={`${t("global.redo")} (Ctrl+Y)`} withArrow>
            <IconButton
              aria-label={t("global.redo")}
              icon={<BiRegularRedo />}
              size="sm"
              variant="ghost"
              onClick={redo}
            />
          </Tooltip>

          <Box w="1px" h="$5" bg="$neutral4" mx="$1" />
        </Show>

        <Tooltip label={`${t("global.copy")} (Ctrl+C)`} withArrow>
          <IconButton
            aria-label={t("global.copy")}
            icon={<TbCopy />}
            size="sm"
            variant="ghost"
            onClick={copyToClipboard}
          />
        </Tooltip>
        <Show when={canWrite()}>
          <Tooltip label={`${t("global.paste")} (Ctrl+V)`} withArrow>
            <IconButton
              aria-label={t("global.paste")}
              icon={<TbClipboardText />}
              size="sm"
              variant="ghost"
              onClick={pasteFromClipboard}
            />
          </Tooltip>
        </Show>

        <Box w="1px" h="$5" bg="$neutral4" mx="$1" />

        <Tooltip label={t("home.local_settings.editor_word_wrap")} withArrow>
          <IconButton
            aria-label={t("home.local_settings.editor_word_wrap")}
            icon={wordWrap() ? <TbTextWrap /> : <TbTextWrapDisabled />}
            size="sm"
            variant="ghost"
            onClick={toggleWordWrap}
            color={wordWrap() ? "$info11" : undefined}
          />
        </Tooltip>

        <Tooltip label={t("home.local_settings.editor_minimap")} withArrow>
          <IconButton
            aria-label={t("home.local_settings.editor_minimap")}
            icon={minimap() ? <TbMap /> : <TbMapOff />}
            size="sm"
            variant="ghost"
            onClick={() => {
              setLocal("editor_minimap", String(!minimap()))
            }}
            color={minimap() ? "$info11" : undefined}
          />
        </Tooltip>

        <Box w="1px" h="$5" bg="$neutral4" mx="$1" />

        <ButtonGroup
          size="sm"
          variant="ghost"
          attached
          display={{ "@initial": "none", "@sm": "flex" }}
        >
          <Tooltip
            label={`${t("global.decrease")} ${t("home.local_settings.editor_font_size")}`}
            withArrow
          >
            <IconButton
              aria-label={`${t("global.decrease")} ${t("home.local_settings.editor_font_size")}`}
              icon={<FaSolidMinus />}
              onClick={() => changeFontSize(-1)}
            />
          </Tooltip>
          <Button fontSize="$xs" color="$neutral11">
            {local.editor_font_size}
          </Button>
          <Tooltip
            label={`${t("global.increase")} ${t("home.local_settings.editor_font_size")}`}
            withArrow
          >
            <IconButton
              aria-label={`${t("global.increase")} ${t("home.local_settings.editor_font_size")}`}
              icon={<FaSolidPlus />}
              onClick={() => changeFontSize(1)}
            />
          </Tooltip>
        </ButtonGroup>

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
          readOnly: !canWrite(),
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
        <Box flex="1" />
        <Box style={{ "white-space": "nowrap" }}>
          Ln {cursorLine()}, Col {cursorColumn()}
        </Box>
        <Box style={{ "white-space": "nowrap" }}>{wordCount()} words</Box>
        <Show when={modified()}>
          <Box color="$warning11" style={{ "white-space": "nowrap" }}>
            ●
          </Box>
        </Show>
      </HStack>
    </VStack>
  )
}

const TextEditor = () => {
  const [content] = useFetchText()
  return (
    <BoxWithFullScreen w="$full" h="70vh">
      <MaybeLoading loading={content.loading}>
        <Editor
          data={content()?.content}
          contentType={content()?.contentType}
        />
      </MaybeLoading>
    </BoxWithFullScreen>
  )
}

export default TextEditor
