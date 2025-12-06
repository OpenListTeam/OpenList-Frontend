import { BoxWithFullScreen, Error, FullLoading } from "~/components"
import { objStore } from "~/store"
import { Box, IconButton, Tooltip, Button, HStack } from "@hope-ui/solid"
import { createSignal, onMount, For, Show } from "solid-js"
import { useT } from "~/hooks"
import { VsScreenFull, VsScreenNormal } from "solid-icons/vs"

// 声明全局ExcelJS类型
declare global {
  interface Window {
    ExcelJS: any
  }
}

interface CellData {
  value: string
  style?: {
    bold?: boolean
    italic?: boolean
    bgColor?: string
    fgColor?: string
    alignment?: string
  }
}

interface SheetData {
  name: string
  rows: CellData[][]
}

const ExcelViewerApp = () => {
  const t = useT()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)
  const [isFullscreen, setIsFullscreen] = createSignal(false)
  const [sheets, setSheets] = createSignal<SheetData[]>([])
  const [currentSheetIndex, setCurrentSheetIndex] = createSignal(0)
  let containerRef: HTMLDivElement | undefined

  // 动态加载ExcelJS库
  const loadExcelJSScript = () => {
    return new Promise<void>((resolve, reject) => {
      // 检查是否已经加载
      if (window.ExcelJS) {
        resolve()
        return
      }

      // 检查脚本标签是否已存在
      const existingScript = document.getElementById("exceljs-script")
      if (existingScript) {
        // 脚本正在加载中，等待加载完成
        existingScript.addEventListener("load", () => resolve())
        existingScript.addEventListener("error", () =>
          reject(new Error("Failed to load ExcelJS library")),
        )
        return
      }

      const script = document.createElement("script")
      script.src = "https://res.oplist.org.cn/exceljs/exceljs.min.js"
      script.id = "exceljs-script"
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error("Failed to load ExcelJS library"))
      document.head.appendChild(script)
    })
  }

  // 加载并解析Excel文件
  const loadExcelFile = async () => {
    try {
      setLoading(true)
      setError(false)

      // 先加载ExcelJS库
      await loadExcelJSScript()

      // 获取文件URL
      const fileUrl = objStore.raw_url

      // 下载文件
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error("Failed to fetch Excel file")
      }

      const arrayBuffer = await response.arrayBuffer()

      // 使用ExcelJS解析文件
      const workbook = new window.ExcelJS.Workbook()
      await workbook.xlsx.load(arrayBuffer)

      // 提取所有工作表数据
      const sheetsData: SheetData[] = []

      workbook.worksheets.forEach((worksheet: any) => {
        const rows: CellData[][] = []

        worksheet.eachRow((row: any, rowNumber: number) => {
          const rowData: CellData[] = []

          row.eachCell(
            { includeEmpty: true },
            (cell: any, colNumber: number) => {
              // 获取单元格值
              let cellValue = ""
              if (cell.value !== null && cell.value !== undefined) {
                if (typeof cell.value === "object" && "text" in cell.value) {
                  cellValue = cell.value.text
                } else if (
                  typeof cell.value === "object" &&
                  "result" in cell.value
                ) {
                  cellValue = String(cell.value.result)
                } else {
                  cellValue = String(cell.value)
                }
              }

              // 获取单元格样式
              const style: CellData["style"] = {}
              if (cell.font) {
                style.bold = cell.font.bold
                style.italic = cell.font.italic
              }
              if (cell.fill && cell.fill.fgColor) {
                style.bgColor = cell.fill.fgColor.argb
              }
              if (cell.alignment) {
                style.alignment = cell.alignment.horizontal || "left"
              }

              rowData.push({ value: cellValue, style })
            },
          )

          rows.push(rowData)
        })

        sheetsData.push({
          name: worksheet.name,
          rows: rows,
        })
      })

      setSheets(sheetsData)
      setLoading(false)
    } catch (e) {
      console.error("Excel加载失败:", e)
      setError(true)
      setLoading(false)
    }
  }

  // 全屏切换
  const toggleFullscreen = () => {
    if (!containerRef) return

    if (!document.fullscreenElement) {
      containerRef.requestFullscreen().then(() => {
        setIsFullscreen(true)
      })
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      })
    }
  }

  onMount(() => {
    loadExcelFile()
  })

  return (
    <BoxWithFullScreen w="$full" h="70vh" pos="relative">
      {/* 工作表标签和全屏按钮 */}
      <Box
        pos="absolute"
        top="$2"
        left="$2"
        right="$2"
        zIndex="10"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        px="$2"
      >
        {/* 工作表标签 */}
        <Show when={!loading() && !error() && sheets().length > 0}>
          <HStack spacing="$2" flexWrap="wrap">
            <For each={sheets()}>
              {(sheet, index) => (
                <Button
                  size="sm"
                  variant={
                    currentSheetIndex() === index() ? "solid" : "outline"
                  }
                  colorScheme="primary"
                  onClick={() => setCurrentSheetIndex(index())}
                >
                  {sheet.name}
                </Button>
              )}
            </For>
          </HStack>
        </Show>

        {/* 全屏按钮 */}
        <Box opacity="0.7" transition="opacity 0.2s" _hover={{ opacity: "1" }}>
          <Tooltip
            withArrow
            label={
              isFullscreen()
                ? t("home.preview.exit_fullscreen")
                : t("home.preview.fullscreen")
            }
          >
            <IconButton
              size="sm"
              colorScheme="neutral"
              aria-label="Toggle Fullscreen"
              icon={isFullscreen() ? <VsScreenNormal /> : <VsScreenFull />}
              onClick={toggleFullscreen}
            />
          </Tooltip>
        </Box>
      </Box>

      {/* Excel表格容器 */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
          position: "relative",
          background: "#ffffff",
          "padding-top": "50px",
        }}
      >
        {/* 表格内容 */}
        <Show when={!loading() && !error() && sheets().length > 0}>
          <div style={{ padding: "20px", overflow: "auto" }}>
            <table
              style={{
                "border-collapse": "collapse",
                width: "100%",
                "background-color": "white",
                "box-shadow": "0 2px 8px rgba(0,0,0,0.1)",
              }}
            >
              <tbody>
                <For each={sheets()[currentSheetIndex()]?.rows || []}>
                  {(row) => (
                    <tr>
                      <For each={row}>
                        {(cell) => (
                          <td
                            style={{
                              border: "1px solid #ddd",
                              padding: "8px 12px",
                              "font-weight": cell.style?.bold
                                ? "bold"
                                : "normal",
                              "font-style": cell.style?.italic
                                ? "italic"
                                : "normal",
                              "background-color": cell.style?.bgColor
                                ? `#${cell.style.bgColor.slice(2)}`
                                : "transparent",
                              "text-align":
                                (cell.style?.alignment as any) || "left",
                              "white-space": "pre-wrap",
                              "word-break": "break-word",
                              "min-width": "100px",
                            }}
                          >
                            {cell.value}
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        {/* 加载状态 */}
        <Show when={loading()}>
          <FullLoading />
        </Show>

        {/* 错误状态 */}
        <Show when={error()}>
          <Error msg={t("preview.failed_load_excel")} h="70vh" />
        </Show>
      </div>
    </BoxWithFullScreen>
  )
}

export default ExcelViewerApp
