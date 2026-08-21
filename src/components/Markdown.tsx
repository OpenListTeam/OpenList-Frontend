import { Anchor, Box, List, ListItem, useColorModeValue } from "@hope-ui/solid"
import { createStorageSignal } from "@solid-primitives/storage"
import { clsx } from "clsx"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Motion } from "solid-motionone"
import { unified } from "unified"
import { useCDN, useParseText, useRouter } from "~/hooks"
import { useScrollListener } from "~/pages/home/toolbar/BackTop.jsx"
import { getMainColor, getSettingBool, me, password } from "~/store"
import {
  api,
  base_path,
  fsGet,
  loadCSS,
  loadScriptIIFE,
  notify,
  pathDir,
  pathJoin,
  pathResolve,
} from "~/utils"
import { isMobile } from "~/utils/compatibility.js"
import hljs from "highlight.js"
import { EncodingSelect } from "."
import "./markdown.css"

type TocItem = { indent: number; text: string; tagName: string; key: string }

const MERMAID_PATTERN = /```mermaid[\s\S]*?```/i
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/

// markdown image syntax pointing to a video file is rendered as <video>
// instead of <img>, since browsers cannot play videos inside <img>
const VIDEO_EXTS = new Set(["mp4", "webm", "ogg", "ogv", "mov", "m4v", "mkv"])

// cache resolved raw urls across Markdown instances
const mediaSrcCache = new Map<string, Promise<string>>()

// origin of the local api, used to tell local media links from external ones
const apiOrigin = new URL(api).origin

// fetch a signed raw url for the given path, returns "" on failure
async function fetchRawUrl(path: string): Promise<string> {
  const cached = mediaSrcCache.get(path)
  if (cached) return cached
  const pending = (async () => {
    const resp = await fsGet(path, password())
    return resp.code === 200 && resp.data?.raw_url ? resp.data.raw_url : ""
  })()
  mediaSrcCache.set(path, pending)
  try {
    const url = await pending
    // do not cache failed lookups so that they can be retried
    if (!url) mediaSrcCache.delete(path)
    return url
  } catch {
    mediaSrcCache.delete(path)
    return ""
  }
}

async function runPool<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = 6,
) {
  let index = 0
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        await worker(items[index++])
      }
    },
  )
  await Promise.all(runners)
}

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
  sanitize: boolean,
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

  if (sanitize) {
    const attrs = defaultSchema.attributes ?? {}
    processor.use(rehypeSanitize, {
      ...defaultSchema,
      // video/audio/track are not in the default element whitelist and
      // would be stripped entirely, breaking markdown video previews
      tagNames: [...(defaultSchema.tagNames ?? []), "video", "audio", "track"],
      attributes: {
        ...attrs,
        code: [
          ["className", /^language-[\w-]+$/, "math-inline", "math-display"],
        ],
        // keep media elements usable: src may be rewritten to a signed url
        video: [
          ...(attrs.video ?? []),
          ["src"],
          ["controls"],
          ["preload"],
          ["poster"],
          ["autoplay"],
          ["loop"],
          ["muted"],
          ["playsinline"],
          ["crossorigin"],
        ],
        audio: [
          ...(attrs.audio ?? []),
          ["src"],
          ["controls"],
          ["preload"],
          ["autoplay"],
          ["loop"],
          ["crossorigin"],
        ],
        source: [
          ...(attrs.source ?? []),
          ["src"],
          ["type"],
        ],
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

  const md = createMemo(() => {
    const raw = text(encoding())
    const content =
      !props.ext || props.ext.toLowerCase() === "md"
        ? raw
        : `\`\`\`${props.ext}\n${raw}\n\`\`\``

    return content.replace(/!\[.*?\]\((.*?)\)/g, (match) => {
      const name = match.match(/!\[(.*?)\]\(.*?\)/)![1]
      const rawUrl = match.match(/!\[.*?\]\((.*?)\)/)![1]

      if (
        rawUrl.startsWith("data:image/") ||
        rawUrl.startsWith("http://") ||
        rawUrl.startsWith("https://") ||
        rawUrl.startsWith("//")
      ) {
        return match
      }

      // a video in image syntax cannot be played by <img>, so turn it
      // into a <video> element; its src is resolved later by fixMediaSrc
      const rawUrlPart = rawUrl.trim().split(/\s+/)[0]
      const ext = rawUrlPart
        .split(/[?#]/)[0]
        .split(".")
        .pop()
        ?.toLowerCase()
      if (ext && VIDEO_EXTS.has(ext)) {
        return `<video controls preload="metadata" src="${rawUrlPart}"></video>`
      }

      const resolvedPath = rawUrl.startsWith("/")
        ? rawUrl
        : pathResolve(props.readme ? pathname() : pathDir(pathname()), rawUrl)

      return `![${name}](${api}/d${pathJoin(me().base_path, resolvedPath)})`
    })
  })

  createEffect(
    on([md, mermaidTheme], async () => {
      setShow(false)

      const { html, hasMermaid } = await renderMarkdown(
        md(),
        props.sanitize || getSettingBool("filter_readme_scripts"),
      )
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

        fixMediaSrc()
        window.onMDRender?.()
      })
    }),
  )

  const [markdownRef, setMarkdownRef] = createSignal<HTMLDivElement>()

  // rewrite relative media src (img/video/audio/source) to signed raw urls,
  // so that previews still work when sign_all is enabled or inside shares
  const fixMediaSrc = async () => {
    const $body = markdownRef()?.querySelector(".markdown-body")
    if (!$body) return
    const pathByEl = new Map<HTMLElement, string>()
    $body
      .querySelectorAll<HTMLElement>("img, video, source, audio")
      .forEach((el) => {
        const src = el.getAttribute("src")
        if (!src) return
        let rawPath = src
        if (/^https?:\/\//i.test(src)) {
          // markdown pipeline emits `${api}/d${...}` links; strip the origin
          // and the deployment base_path to recover the storage path
          let url: URL
          try {
            url = new URL(src)
          } catch {
            return // malformed url, keep the src as-is
          }
          if (url.origin !== apiOrigin) return // external link, keep as-is
          rawPath = url.pathname
          if (base_path && rawPath.startsWith(base_path)) {
            rawPath = rawPath.slice(base_path.length) || "/"
          }
        } else if (/^(data:|blob:|\/\/)/i.test(src)) {
          return // inline or protocol-relative external resource
        }
        if (/^\/(d|p)\//.test(rawPath)) {
          // strip the /d or /p proxy prefix to get the storage path
          rawPath = rawPath.slice(3)
        } else if (!rawPath.startsWith("/")) {
          rawPath = pathResolve(
            props.readme ? pathname() : pathDir(pathname()),
            rawPath,
          )
        }
        rawPath = rawPath.split(/[?#]/)[0]
        try {
          rawPath = decodeURIComponent(rawPath)
        } catch {
          // keep the raw path if it contains malformed percent encoding
        }
        pathByEl.set(el, pathJoin(me().base_path, rawPath))
      })
    const urlByPath = new Map<string, string>()
    const paths = Array.from(new Set(pathByEl.values()))
    await runPool(paths, async (path) => {
      const url = await fetchRawUrl(path)
      if (url) urlByPath.set(path, url)
    })
    pathByEl.forEach((path, el) => {
      const url = urlByPath.get(path)
      if (url) el.setAttribute("src", url)
    })
  }

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
