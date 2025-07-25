import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbProps,
  BreadcrumbSeparator,
  HStack,
  Text,
} from "@hope-ui/solid"
import { Link } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { usePath, useRouter, useT } from "~/hooks"
import { getSetting, local, objStore, State } from "~/store"
import { encodePath, hoverColor, joinBase } from "~/utils"
import CheckMarkIcon from "/images/check_mark_button_color.svg"
import FolderIcon from "/images/file_folder_color.svg"
import FileIcon from "/images/page_facing_up_color.svg"

export const Nav = () => {
  const { pathname } = useRouter()
  const paths = createMemo(() => ["", ...pathname().split("/").filter(Boolean)])
  const t = useT()
  const { setPathAs } = usePath()

  const folderInfo = createMemo(() => {
    const { dir, file } = objStore.objs.reduce(
      (acc, item) => {
        if (item.is_dir) {
          acc.dir++
        } else {
          acc.file++
        }
        return acc
      },
      { dir: 0, file: 0 },
    )

    const parts: JSX.Element[] = []
    if (dir) {
      parts.push(
        <span style="display: inline-flex; align-items: center;">
          <img
            src={FolderIcon}
            alt="folder"
            style="width: 1em; height: 1em; margin-right: 0.25em; vertical-align: middle;"
          />
          {dir}
        </span>,
      )
    }
    if (file) {
      parts.push(
        <span style="display: inline-flex; align-items: center;">
          <img
            src={FileIcon}
            alt="file"
            style="width: 1em; height: 1em; margin-right: 0.25em; vertical-align: middle;"
          />
          {file}
        </span>,
      )
    }

    if (parts.length === 0) return null

    return (
      <>
        {parts.map((part, index) => (
          <>
            {part}
            {index < parts.length - 1 && <span style="margin: 0 0.3em;"></span>}
          </>
        ))}
      </>
    )
  })
  const selectInfo = createMemo(() => {
    const { selected } = objStore.objs.reduce(
      (acc, item) => {
        if (item.selected) acc.selected++
        return acc
      },
      { selected: 0 },
    )

    if (!selected) {
      return null
    }
    // return `✅ ${selected} `
    return (
      <span style="display: inline-flex; align-items: center;">
        <img
          src={CheckMarkIcon}
          alt="check"
          style="width: 1em; height: 1em; margin-right: 0.25em; vertical-align: middle;"
        />
        {selected}
      </span>
    )
  })
  const stickyProps = createMemo<BreadcrumbProps>(() => {
    const mask: BreadcrumbProps = {
      _after: {
        content: "",
        bgColor: "$background",
        position: "absolute",
        height: "100%",
        width: "99vw",
        zIndex: -1,
        transform: "translateX(-50%)",
        left: "50%",
        top: 0,
      },
    }

    switch (local["position_of_header_navbar"]) {
      case "only_navbar_sticky":
        return { ...mask, position: "sticky", zIndex: "$sticky", top: 0 }
      case "sticky":
        return { ...mask, position: "sticky", zIndex: "$sticky", top: 60 }
      default:
        return {
          _after: undefined,
          position: undefined,
          zIndex: undefined,
          top: undefined,
        }
    }
  })

  return (
    <HStack background="$background" class="nav" w="$full">
      <Breadcrumb {...stickyProps} flexGrow="1">
        <For each={paths()}>
          {(name, i) => {
            const isLast = createMemo(() => i() === paths().length - 1)
            const path = paths()
              .slice(0, i() + 1)
              .join("/")
            const href = encodePath(path)
            let text = () => name
            if (text() === "") {
              text = () => getSetting("home_icon") + t("manage.sidemenu.home")
            }
            return (
              <BreadcrumbItem class="nav-item">
                <BreadcrumbLink
                  class="nav-link"
                  css={{
                    wordBreak: "break-all",
                  }}
                  color="unset"
                  _hover={{ bgColor: hoverColor(), color: "unset" }}
                  _active={{ transform: "scale(.95)", transition: "0.1s" }}
                  cursor="pointer"
                  p="$1"
                  rounded="$lg"
                  currentPage={isLast()}
                  as={isLast() ? undefined : Link}
                  href={joinBase(href)}
                  onMouseEnter={() => setPathAs(path)}
                >
                  {text()}
                </BreadcrumbLink>
                <Show when={!isLast()}>
                  <BreadcrumbSeparator class="nav-separator" />
                </Show>
              </BreadcrumbItem>
            )
          }}
        </For>
      </Breadcrumb>
      <Show when={objStore.state == State.Folder}>
        <Text
          css={{
            whiteSpace: "nowrap",
            userSelect: "none",
            display: "flex",
            alignItems: "center",
          }}
          p="$1"
        >
          {selectInfo()}
          {selectInfo() && <span style="margin-right: 0.5em;"></span>}
          {folderInfo()}
        </Text>
      </Show>
    </HStack>
  )
}
