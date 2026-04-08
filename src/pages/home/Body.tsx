import { VStack } from "@hope-ui/solid"
import { Obj } from "./Obj"
import { Readme } from "./Readme"
import { Sidebar } from "./Sidebar"

export const Body = () => {
  return (
    <div style={{ flex: "1", width: "100%", padding: "0 2% 16px" }}>
      <VStack class="body" mt="$1" py="$2" minH="80vh" w="$full" gap="$4">
        <Readme files={["header.md", "top.md", "index.md"]} fromMeta="header" />
        <Obj />
        <Readme
          files={["readme.md", "footer.md", "bottom.md"]}
          fromMeta="readme"
        />
        <Sidebar />
      </VStack>
    </div>
  )
}
