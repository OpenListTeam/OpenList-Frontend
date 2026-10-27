import { Component, lazy } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Center, Heading } from "@hope-ui/solid"
import { trimLeft } from "~/utils"
import { MustAdmin } from "~/app/MustAdmin"
import { SideMenuItem, side_menu_items } from "./sidemenu_items"
import { useManageTitle } from "~/hooks"

type Route = Pick<SideMenuItem, "to" | "component" | "backend">

const hide_routes: Route[] = [
  {
    to: "/storages/add",
    component: lazy(() => import("./storages/AddOrEdit")),
  },
  {
    to: "/storages/edit/:id",
    component: lazy(() => import("./storages/AddOrEdit")),
  },
  {
    to: "/shares/add",
    component: lazy(() => import("./shares/AddOrEdit")),
  },
  {
    to: "/shares/edit/:id",
    component: lazy(() => import("./shares/AddOrEdit")),
  },
  {
    to: "/users/add",
    component: lazy(() => import("./users/AddOrEdit")),
  },
  {
    to: "/users/edit/:id",
    component: lazy(() => import("./users/AddOrEdit")),
  },
  {
    to: "/metas/add",
    component: lazy(() => import("./metas/AddOrEdit")),
  },
  {
    to: "/metas/edit/:id",
    component: lazy(() => import("./metas/AddOrEdit")),
  },
  {
    to: "/2fa",
    component: lazy(() => import("./users/2fa")),
  },
  {
    to: "/plugins/add",
    backend: ["ts-worker"],
    component: lazy(() => import("./plugins/AddPlugin")),
  },
  {
    to: "/plugins/config/:id",
    backend: ["ts-worker"],
    component: lazy(() => import("./plugins/ConfigPlugin")),
  },
  {
    to: "/messenger",
    component: lazy(() => import("./messenger/Messenger")),
  },
]

const Placeholder = (props: { title: string; to: string }) => {
  useManageTitle(props.title)
  return (
    <Center h="$full">
      <Heading>{props.title}</Heading>
    </Center>
  )
}

/**
 * 媒体库后台（/@manage/media/*）整体要求管理员权限。
 * 管理侧边栏对非管理员本来就隐藏了入口（SideMenu 按 role 过滤），
 * 但 URL 直连 / 媒体库侧栏的「设置」按钮仍能进到页面，这里补一层路由守卫。
 */
const withAdminGuard = (to: string, component: Component) => {
  // 站点设置与媒体库后台都只对管理员开放；其余页面（个人资料 / 2FA 等）保持原样
  if (!to.startsWith("/media") && !to.startsWith("/settings")) return component
  return () => (
    <MustAdmin>
      <Dynamic component={component} />
    </MustAdmin>
  )
}

const get_routes = (items: SideMenuItem[], acc: Route[] = []) => {
  items.forEach((item) => {
    if (item.children) {
      get_routes(item.children, acc)
    } else {
      const to = trimLeft(item.to!, "/@manage")
      acc.push({
        to,
        backend: item.backend,
        component: item.component
          ? withAdminGuard(to, item.component)
          : () => <Placeholder title={item.title} to={item.to || "empty"} />,
      })
    }
  })
  return acc
}

const routes = get_routes(side_menu_items).concat(hide_routes)
export { routes }
