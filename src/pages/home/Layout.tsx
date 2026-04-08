import { Markdown } from "~/components"
import { useTitle } from "~/hooks"
import { getSetting } from "~/store"
import { notify } from "~/utils"
import { Body } from "./Body"
import { Footer } from "./Footer"
import { Toolbar } from "./toolbar/Toolbar"
import { onMount } from "solid-js"

let announcementShown = false

const Index = () => {
  useTitle(getSetting("site_title"))
  const announcement = getSetting("announcement")

  onMount(() => {
    if (announcement && !announcementShown) {
      notify.render(() => <Markdown children={announcement} />)
      announcementShown = true
    }
  })
  return (
    <div
      style={{
        "min-height": "100vh",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      <Toolbar />
      <Body />
      <Footer />
    </div>
  )
}

export default Index
