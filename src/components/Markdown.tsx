import { Anchor, Box, List, ListItem, useColorModeValue } from "@hope-ui/solid"
import { createStorageSignal } from "@solid-primitives/storage"
import { clsx } from "clsx"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  untrack,
} from "solid-js"
import { Motion } from "solid-motionone"
import { unified } from "unified"
import { useCDN, useParseText, useRouter } from "~/hooks"
import { useScrollListener } from "~/pages/home/toolbar/BackTop.jsx"
import { getMainColor, getSettingBool, objStore } from "~/store"
import { loadCSS, loadScriptIIFE, notify, pathDir, pathJoin } from "~/utils"
import { isMobile } from "~/utils/compatibility.js"
import hljs from "highlight.js"
import { EncodingSelect } from "."
import { watchMediaSrc } from "./markdown/media-fallback"
import { rehypeMedia } from "./markdown/rehype-media"
import type { HastNode, MediaContext } from "./markdown/rehype-media"
import "./markdown.css"

type TocItem = { indent: number; text: string; tagName: string; key: string }

const MERMAID_PATTERN = /```mermaid[\s\S]*?```/i
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/

const [isTocVisible, setVisible] = createSignal(false)
const [isTocDisabled, setTocDisabled] = createStorageSignal(
  "isMarkdownTocDisabled",
  true,
  {
    serializer: (v: boolean) => JSON.stringify(v),
    deserializer: (v) => JSON.parse(v),
  },
)

export { isTocVisible, setTocDisabled }

function MarkdownToc(props: {
  disabled?: boolean
  markdownRef: HTMLDivElement
}) {
  if (props.disabled || isMobile) return null

  const [tocList, setTocList] = createSignal<TocItem[]>([])

  useScrollListener(
    () => setVisible(window.scrollY > 100 && tocList().length > 1),
    { immediate: true },
  )

  createEffect(() => {
    const $markdown = props.markdownRef.querySelector(".markdown-body")
    if (!$markdown) return

    const iterator = document.createNodeIterator(
      $markdown,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) =>
          /h[1-3]/i.test(node.nodeName)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      },
    )

    const items: TocItem[] = []
    let $next = iterator.nextNode()
    let minLevel = 6

    while ($next) {
      const level = Number($next.nodeName.match(/h(\d)/i)![1])
      if (level < minLevel) minLevel = level
      items.push({
        indent: level,
        text: $next.textContent!,
        tagName: $next.nodeName.toLowerCase(),
        key: ($next as Element).getAttribute("key")!,
      })
      $next = iterator.nextNode()
    }

    setTocList(
      items.map((item) => ({ ...item, indent: item.indent - minLevel })),
    )
  })

  const handleAnchor = (item: TocItem) => {
    const $target = props.markdownRef.querySelector(
      `${item.tagName}[key=${item.key}]`,
    )
    if (!$target) return

    const navBottom = Math.max(
      document.querySelector(".nav")?.getBoundingClientRect().bottom ?? 0,
      0,
    )
    window.scrollBy({
      behavior: "smooth",
      top: $target.getBoundingClientRect().y - navBottom,
    })
  }

  const initialOffsetX = "calc(100% - 20px)"
  const [offsetX, setOffsetX] = createSignal<number | string>(initialOffsetX)

  return (
    <Show when={!isTocDisabled() && isTocVisible()}>
      <Box
        as={Motion.div}
        initial={{ x: 999 }}
        animate={{ x: offsetX() }}
        onMouseEnter={() => setOffsetX(0)}
        onMouseLeave={() => setOffsetX(initialOffsetX)}
        zIndex="$overlay"
        pos="fixed"
        right="$6"
        top="$6"
      >
        <Box
          mt="$5"
          p="$2"
          shadow="$outline"
          rounded="$lg"
          bgColor="white"
          _dark={{ bgColor: "$neutral3" }}
        >
          <List maxH="60vh" overflowY="auto">
            <For each={tocList()}>
              {(item) => (
                <ListItem pl={15 * item.indent} m={4}>
                  <Anchor
                    color={getMainColor()}
                    onClick={() => handleAnchor(item)}
                  >
                    {item.text}
                  </Anchor>
                </ListItem>
              )}
            </For>
          </List>
        </Box>
      </Box>
    </Show>
  )
}

const { katexCSSPath, mermaidJSPath } = useCDN()

async function renderMarkdown(
  content: string,
  ctx: { sanitize: boolean } & MediaContext,
): Promise<{ html: string; hasMermaid: boolean }> {
  let processor = unified()

  processor.use(remarkParse).use(remarkGfm)

  const hasMermaid = MERMAID_PATTERN.test(content)
  const hasMath = MATH_PATTERN.test(content)
  if (hasMath) {
    const { default: remarkMath } = await import("remark-math")
    processor.use(remarkMath)
    await loadCSS(katexCSSPath(), "katex").catch(() =>
      notify.error(
        "Failed to load KaTeX CSS, math formulas will not be rendered",
      ),
    )
  }
  if (hasMermaid) {
    await loadScriptIIFE(mermaidJSPath(), "mermaid").catch(() =>
      notify.error("Failed to load Mermaid JS, diagrams will not be rendered"),
    )
  }

  processor.use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw)
  // resolve media urls and render the image syntax of a video as a player
  processor.use(() => (tree: unknown) => rehypeMedia(tree as HastNode, ctx))

  if (ctx.sanitize) {
    const attrs = defaultSchema.attributes ?? {}
    const allow = (tag: string, ...names: string[]) => [
      ...(attrs[tag] ?? []),
      ...names,
    ]
    processor.use(rehypeSanitize, {
      ...defaultSchema,
      // video/audio/track are not in the default element whitelist and
      // would be stripped entirely, breaking markdown video previews
      tagNames: [...(defaultSchema.tagNames ?? []), "video", "audio", "track"],
      // the default only allows http/https, which drops inline base64 pictures
      protocols: {
        ...defaultSchema.protocols,
        src: [...(defaultSchema.protocols?.src ?? []), "data"],
      },
      attributes: {
        ...attrs,
        // `data-md-path` feeds the runtime fallback of media links
        "*": allow("*", "data*"),
        code: [
          ["className", /^language-[\w-]+$/, "math-inline", "math-display"],
        ],
        // attribute names are hast properties, not html attributes
        video: allow(
          "video",
          "src",
          "poster",
          "controls",
          "preload",
          "autoplay",
          "loop",
          "muted",
          "playsInline",
          "crossOrigin",
        ),
        audio: allow(
          "audio",
          "src",
          "controls",
          "preload",
          "autoplay",
          "loop",
          "muted",
          "crossOrigin",
        ),
        source: allow("source", "src", "srcSet", "type", "media"),
        track: allow("track", "src", "kind", "label", "srclang", "default"),
      },
    })
  }

  if (hasMath) {
    const { default: rehypeKatex } = await import("rehype-katex")
    processor.use(rehypeKatex)
  }

  processor.use(rehypeStringify)

  const result = await processor.process(content)

  return { html: String(result), hasMermaid }
}

export function Markdown(props: {
  children?: string | ArrayBuffer
  class?: string
  ext?: string
  readme?: boolean
  toc?: boolean
  sanitize?: boolean
}) {
  const [encoding, setEncoding] = createSignal<string>("utf-8")
  const [show, setShow] = createSignal(true)
  const [markdownHTML, setMarkdownHTML] = createSignal<string>("")
  const mermaidTheme = useColorModeValue("default", "dark")
  const { isString, text } = useParseText(props.children)
  const { pathname } = useRouter()

  // media urls of the markdown are relative to the dir it belongs to: the
  // folder itself for a readme, the parent dir for a previewed file
  const baseDir = createMemo(() =>
    props.readme ? pathname() : pathDir(pathname()),
  )
  // the listing already carries the sign of every object next to the markdown
  const siblingSigns = () => {
    const signs = new Map<string, string>()
    for (const obj of objStore.objs) {
      if (obj.sign) signs.set(pathJoin(baseDir(), obj.name), obj.sign)
    }
    return signs
  }

  const md = createMemo(() => {
    const raw = text(encoding())
    return !props.ext || props.ext.toLowerCase() === "md"
      ? raw
      : `\`\`\`${props.ext}\n${raw}\n\`\`\``
  })

  createEffect(
    on([md, mermaidTheme], async () => {
      setShow(false)

      const { html, hasMermaid } = await renderMarkdown(md(), {
        sanitize: props.sanitize || getSettingBool("filter_readme_scripts"),
        baseDir: baseDir(),
        // untracked: appending objects must not re-render the whole markdown
        signs: untrack(siblingSigns),
      })
      setMarkdownHTML(html)

      setTimeout(() => {
        setShow(true)
        // Only highlight code blocks with an explicit, supported language
        const noHighlight = new Set([
          "language-plain",
          "language-plaintext",
          "language-text",
        ])
        markdownRef()
          ?.querySelectorAll('pre code[class*="language-"]')
          ?.forEach((el) => {
            const classList = (el as HTMLElement).classList
            const langClass = Array.from(classList).find((c) =>
              c.startsWith("language-"),
            )
            if (
              langClass &&
              !noHighlight.has(langClass) &&
              hljs.getLanguage(langClass.replace("language-", ""))
            ) {
              hljs.highlightElement(el as HTMLElement)
            }
          })
        if (hasMermaid && window.mermaid) {
          window.mermaid.initialize({
            startOnLoad: false,
            theme: mermaidTheme(),
          })
          window.mermaid.run({ querySelector: ".language-mermaid" })
        }

        watchMediaSrc(markdownRef())
        window.onMDRender?.()
      })
    }),
  )

  const [markdownRef, setMarkdownRef] = createSignal<HTMLDivElement>()

  return (
    <Box
      ref={(r: HTMLDivElement) => setMarkdownRef(r)}
      class="markdown"
      pos="relative"
      w="$full"
    >
      <Show when={show()}>
        <Box
          class={clsx("markdown-body", props.class)}
          innerHTML={markdownHTML()}
        />
      </Show>
      <Show when={!isString}>
        <EncodingSelect
          encoding={encoding()}
          setEncoding={setEncoding}
          referenceText={props.children}
        />
      </Show>
      <MarkdownToc disabled={!props.toc} markdownRef={markdownRef()!} />
    </Box>
  )
}
