import { Grid } from "@hope-ui/solid"
import { JSXElement } from "solid-js"
import { getSetting } from "~/store"

export const ResponsiveGrid = (props: { children: JSXElement }) => {
  const layout = getSetting("settings_layout")
  // settings_layout=list 时强制单列，避免外部页面再写死 @md/@lg 宽度。
  // settings_layout=responsive 时在宽屏按 Settings 的既有阈值自动分列。
  const templateColumns =
    layout === "responsive"
      ? {
          "@initial": "1fr",
          "@lg": "repeat(auto-fill, minmax(424px, 1fr))",
        }
      : "1fr"

  return (
    <Grid w="$full" gap="$2" templateColumns={templateColumns}>
      {props.children}
    </Grid>
  )
}
