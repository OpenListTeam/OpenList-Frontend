import { JSXElement, Show, createEffect } from "solid-js"
import { useRouter, useT } from "~/hooks"
import { me } from "~/store"
import { UserMethods } from "~/types"
import { notify } from "~/utils"

/**
 * 管理员页面守卫（媒体库后台设置 / 刮削 / STRM 等）。
 *
 * 后端 `/api/admin/*` 已经要求管理员权限，但前端 `/@manage/*` 路由只包了
 * `MustUser`：访客（启用 guest 时的未登录身份）和普通用户照样能打开管理页外壳，
 * 页面里全是 403，看起来像「设置能打开但什么都没加载」。
 *
 * - 访客（未登录）：跳登录页，登录后回到原地址；
 * - 已登录但不是管理员：回首页并提示。
 *   （不能再跳登录：登录页对已登录用户会自动跳回 redirect，形成来回重定向）
 */
export const MustAdmin = (props: { children: JSXElement }) => {
  const { to } = useRouter()
  const t = useT()
  // me 的初始值是 {}：外层的 MustUser 还没拿到 /me 时不能下判断，
  // 否则管理员的 role 还是 undefined，会被当成「非管理员」直接弹回首页
  const ready = () => !!me().username
  const allowed = () => ready() && UserMethods.is_admin(me())

  createEffect(() => {
    if (!ready() || allowed()) return
    if (UserMethods.is_guest(me())) {
      const redirect = encodeURIComponent(location.pathname + location.search)
      to(`/@login?redirect=${redirect}`)
      return
    }
    notify.error(t("manage.no_permission"))
    to("/")
  })

  return <Show when={allowed()}>{props.children}</Show>
}
