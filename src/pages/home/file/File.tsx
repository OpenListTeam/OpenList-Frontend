import { HStack, VStack } from "@hope-ui/solid"
import { createMemo, Show, Suspense } from "solid-js"
import { Dynamic } from "solid-js/web"
import { FullLoading, SelectWrapper } from "~/components"
import { objStore } from "~/store"
import { useRouter } from "~/hooks"
import { Download } from "../previews/download"
import { OpenWith } from "./open-with"
import { getPreviews } from "../previews"

const File = () => {
  const { searchParams, setSearchParams } = useRouter()
  const previews = getPreviews({ ...objStore.obj, provider: objStore.provider })
  const cur = createMemo(() => {
    if (!previews.length) return undefined
    const selected = searchParams["preview"]
    if (!selected) return previews[0]
    return previews.find((p) => p.key === selected) || previews[0]
  })

  return (
    <Show when={previews.length > 1} fallback={<Download />}>
      <VStack w="$full" spacing="$2">
        <HStack w="$full" spacing="$2">
          <SelectWrapper
            alwaysShowBorder
            value={cur()?.key || ""}
            onChange={(key) => {
              setSearchParams({ preview: key }, { replace: true })
            }}
            options={previews.map((item) => ({
              value: item.key,
              label: item.name,
            }))}
          />
          <OpenWith />
        </HStack>
        <Suspense fallback={<FullLoading />}>
          <Dynamic component={cur()?.component} />
        </Suspense>
      </VStack>
    </Show>
  )
}

export default File
