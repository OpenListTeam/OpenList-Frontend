import { Icon } from "@hope-ui/solid"
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
} from "solid-js"
import { getMainColor } from "~/store"
import { useLink } from "~/hooks"
import { Obj, ObjTree, ArchiveObj } from "~/types"
import { fsArchiveMeta } from "~/utils"
import { getIconByObj } from "~/utils/icon"

/* ============ 封面缓存 ============ */
export const archiveCoverCache = new Map<string, string | null>()

const coverCacheKey = (obj: Obj) => obj.path ?? `${obj.name}:${obj.modified}`

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i

const findFirstImage = (
  node: ObjTree[] | ObjTree | null | undefined,
  base = "",
): { name: string; path: string } | null => {
  if (!node) return null
  const children = Array.isArray(node) ? node : ((node as any).children ?? [])
  for (const item of children) {
    const full = base + "/" + item.name
    if (!item.is_dir && IMAGE_EXT.test(item.name)) {
      return { name: item.name, path: full }
    }
    if (item.is_dir && item.children) {
      const found = findFirstImage(item.children, full)
      if (found) return found
    }
  }
  return null
}

/* ============ 并发控制 ============ */
const MAX_CONCURRENT = 4
let running = 0
const queue: (() => void)[] = []
const runLimited = <T,>(task: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++
      task()
        .then(resolve, reject)
        .finally(() => {
          running--
          const next = queue.shift()
          next?.()
        })
    }
    if (running < MAX_CONCURRENT) run()
    else queue.push(run)
  })
}

/* ============ 进入视口 ============ */
const useInView = (options?: IntersectionObserverInit) => {
  const [inView, setInView] = createSignal(false)
  let observer: IntersectionObserver | undefined

  const observe = (node: Element) => {
    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true)
          observer?.disconnect()
          observer = undefined
        }
      }
    }, options)
    observer.observe(node)
  }

  onCleanup(() => {
    observer?.disconnect()
    observer = undefined
  })

  return { inView, observe }
}

/* ============ ArchiveCover ============ */
export type ArchiveCoverProps = {
  obj: Obj
  pathname: string
  password: string
  height?: number | string
  width?: number | string
  onCoverReady?: (url: string) => void
  fallbackIcon?: () => any
}

export const ArchiveCover = (props: ArchiveCoverProps) => {
  const { rawLink } = useLink()
  const { inView, observe } = useInView({
    rootMargin: "200px",
    threshold: 0.01,
  })
  const [imgError, setImgError] = createSignal(false)

  const [cover] = createResource(
    () => (inView() ? props.obj : null),
    async (obj) => {
      if (!obj) return null
      const key = coverCacheKey(obj)
      if (archiveCoverCache.has(key)) {
        console.log(
          "[ArchiveCover] cache hit",
          props.obj.name,
          archiveCoverCache.get(key),
        )
        return archiveCoverCache.get(key) ?? null
      }

      const resp = await runLimited(() =>
        fsArchiveMeta(props.pathname, props.password, ""),
      )
      console.log("[ArchiveCover] meta code", props.obj.name, resp.code)

      if (resp.code === 202) {
        archiveCoverCache.set(key, null)
        return null
      }

      const first = findFirstImage(resp.data?.content as any)
      console.log("[ArchiveCover] first", props.obj.name, first)
      if (!first) {
        archiveCoverCache.set(key, null)
        return null
      }

      const dirPath = first.path.endsWith("/" + first.name)
        ? first.path.slice(0, -first.name.length - 1)
        : ""

      const coverObj: ArchiveObj = {
        ...obj,
        name: first.name,
        is_dir: false,
        sign: resp.data.sign,
        inner_path: dirPath,
        archive: obj,
        pass: "",
      }
      const url = rawLink(coverObj)
      console.log("[ArchiveCover] cover url", props.obj.name, url)
      archiveCoverCache.set(key, url)
      props.onCoverReady?.(url)
      return url
    },
  )

  // 只要 cover 为空或图片加载失败，就显示图标
  const showCover = () => !!cover() && !imgError()

  return (
    <div
      ref={observe}
      style={{
        width: "100%",
        height: `${props.height ?? 120}px`,
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        overflow: "hidden",
      }}
    >
      <Show
        when={showCover()}
        fallback={
          props.fallbackIcon ? (
            props.fallbackIcon()
          ) : (
            <Icon
              as={getIconByObj(props.obj)}
              boxSize="$8"
              color={getMainColor()}
            />
          )
        }
      >
        <img
          src={cover()!}
          loading="lazy"
          style={{
            width: "100%",
            height: "100%",
            "object-fit": "cover",
            display: "block",
          }}
          onError={() => setImgError(true)}
        />
      </Show>
    </div>
  )
}
