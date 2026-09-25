import {
  lazy,
  createEffect,
  createMemo,
  onCleanup,
  Switch,
  Match,
  on,
} from "solid-js"
import { layout, setLayout } from "~/store"
import { ContextMenu } from "./context-menu"
import { Pager } from "./Pager"
import { useLink, useT } from "~/hooks"
import { objStore, local } from "~/store"
import { ObjType } from "~/types"
import { bus } from "~/utils"
import lightGallery from "lightgallery"
import lgThumbnail from "lightgallery/plugins/thumbnail"
import lgZoom from "lightgallery/plugins/zoom"
import lgRotate from "lightgallery/plugins/rotate"
import lgAutoplay from "lightgallery/plugins/autoplay"
import lgFullscreen from "lightgallery/plugins/fullscreen"
import "lightgallery/css/lightgallery-bundle.css"
import { LightGallery } from "lightgallery/lightgallery"
import { Search } from "./Search"

const ListLayout = lazy(() => import("./List"))
const GridLayout = lazy(() => import("./Grid"))
const ImageLayout = lazy(() => import("./Images"))

// 视频扩展名列表，可根据需要增删
const VIDEO_EXTS = ["mp4", "mkv", "avi", "mov", "flv", "ts", "webm", "m4v"]

const isVideo = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() || ""
  return VIDEO_EXTS.includes(ext)
}

const Folder = () => {
  const { rawLink } = useLink()
  const images = createMemo(() =>
    objStore.objs.filter((obj) => obj.type === ObjType.IMAGE),
  )

  // 只有当前文件夹"只包含视频"时，才自动切换到网格视图
  createEffect(
    on(
      () => objStore.objs,
      (objs) => {
        if (objs.length === 0) return

        // 判断是否全是视频（排除文件夹）
        const allVideos = objs.every(
          (obj) => !obj.is_dir && isVideo(obj.name),
        )

        if (allVideos && layout() !== "grid") {
          // setLayout 会按当前 pathname 记录布局，
          // 只影响这个文件夹，不改变其他目录的默认布局
          setLayout("grid")
        }
        // 不满足条件时不做任何事，layout() 会自动回退到用户默认布局
      },
    ),
  )

  let dynamicGallery: LightGallery | undefined
  const initGallery = () => {
    dynamicGallery = lightGallery(document.createElement("div"), {
      addClass: "lightgallery-container",
      dynamic: true,
      thumbnail: local["show_gallery_thumbnails"] === "visible",
      plugins: [lgZoom, lgThumbnail, lgRotate, lgAutoplay, lgFullscreen],
      dynamicEl: images().map((obj) => {
        const raw = rawLink(obj, true)
        return {
          src: raw,
          thumb: obj.thumb === "" ? raw : obj.thumb,
          subHtml: `<h4>${obj.name}</h4>`,
        }
      }),
    })
  }
  createEffect(
    on([images, () => local["show_gallery_thumbnails"]], () => {
      dynamicGallery?.destroy()
      dynamicGallery = undefined
    }),
  )
  bus.on("gallery", (name) => {
    if (!dynamicGallery) {
      initGallery()
    }
    dynamicGallery?.openGallery(images().findIndex((obj) => obj.name === name))
  })
  onCleanup(() => {
    bus.off("gallery")
    dynamicGallery?.destroy()
  })
  const t = useT()
  return (
    <>
      <Switch>
        <Match when={layout() === "list"}>
          <ListLayout />
        </Match>
        <Match when={layout() === "grid"}>
          <GridLayout />
        </Match>
        <Match when={layout() === "image"}>
          <ImageLayout images={images()} />
        </Match>
      </Switch>
      <Pager />
      <Search />
      <ContextMenu />
    </>
  )
}

export default Folder
