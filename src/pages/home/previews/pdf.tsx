import { BoxWithFullScreen } from "~/components"
import { usePDFSlick } from "@pdfslick/solid"
import { objStore } from "~/store"
import "@pdfslick/solid/dist/pdf_viewer.css"

const PDFViewerApp = () => {
  const {
    viewerRef,
    pdfSlickStore: store,
    PDFSlickViewer,
  } = usePDFSlick(objStore.raw_url)

  return (
    <BoxWithFullScreen w="$full" h="70vh">
      <PDFSlickViewer {...{ store, viewerRef }} />
    </BoxWithFullScreen>
  )
}

export default PDFViewerApp
