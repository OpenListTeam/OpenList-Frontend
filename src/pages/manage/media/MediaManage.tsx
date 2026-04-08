import {
  createSignal,
  createResource,
  Show,
  For,
  createEffect,
  onCleanup,
} from "solid-js"
import {
  adminGetMediaConfigs,
  adminSaveMediaConfig,
  adminGetMediaItems,
  adminUpdateMediaItem,
  adminDeleteMediaItem,
  adminStartMediaScan,
  adminStartMediaScrape,
  adminClearMediaDB,
  adminGetMediaScanProgress,
  adminListMediaScanPaths,
  adminCreateMediaScanPath,
  adminUpdateMediaScanPath,
  adminDeleteMediaScanPath,
  adminClearMediaScanPathDB,
} from "~/utils/media_api"
import type { MediaType, MediaItem, MediaConfig, MediaScanPath } from "~/types"

// ==================== 通知组件 ====================
interface ToastProps {
  message: string
  type: "success" | "error" | "warning" | "info"
  onClose: () => void
}

const Toast = (props: ToastProps) => {
  const colors = {
    success: { bg: "#f0fdf4", border: "#86efac", text: "#166534", icon: "✓" },
    error: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", icon: "✕" },
    warning: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", icon: "⚠" },
    info: { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", icon: "ℹ" },
  }
  const c = colors[props.type]
  return (
    <div
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        "z-index": "9999",
        background: c.bg,
        border: `1px solid ${c.border}`,
        "border-radius": "10px",
        padding: "12px 16px",
        display: "flex",
        "align-items": "center",
        gap: "10px",
        "box-shadow": "0 4px 20px rgba(0,0,0,0.12)",
        "min-width": "280px",
        "max-width": "400px",
        animation: "slideIn 0.3s ease",
      }}
    >
      <span
        style={{ color: c.text, "font-size": "16px", "font-weight": "600" }}
      >
        {c.icon}
      </span>
      <span style={{ color: c.text, "font-size": "14px", flex: "1" }}>
        {props.message}
      </span>
      <button
        onClick={props.onClose}
        style={{
          background: "none",
          border: "none",
          color: c.text,
          cursor: "pointer",
          "font-size": "16px",
          padding: "0",
          opacity: "0.6",
        }}
      >
        ×
      </button>
    </div>
  )
}

// ==================== 确认弹窗 ====================
interface ConfirmDialogProps {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: "danger" | "warning" | "info"
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDialog = (props: ConfirmDialogProps) => {
  const confirmColor =
    props.type === "danger"
      ? "#ef4444"
      : props.type === "warning"
        ? "#f59e0b"
        : "#6366f1"
  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.5)",
        "z-index": "1000",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "backdrop-filter": "blur(4px)",
      }}
    >
      <div
        style={{
          background: "white",
          "border-radius": "16px",
          padding: "28px",
          width: "400px",
          "max-width": "90vw",
          "box-shadow": "0 25px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            "font-size": "18px",
            "font-weight": "600",
            color: "#111827",
            "margin-bottom": "10px",
          }}
        >
          {props.title}
        </div>
        <div
          style={{
            "font-size": "14px",
            color: "#6b7280",
            "margin-bottom": "24px",
            "line-height": "1.6",
          }}
        >
          {props.message}
        </div>
        <div
          style={{
            display: "flex",
            gap: "10px",
            "justify-content": "flex-end",
          }}
        >
          <button
            onClick={props.onCancel}
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              "border-radius": "8px",
              color: "#374151",
              padding: "8px 18px",
              cursor: "pointer",
              "font-size": "14px",
            }}
          >
            {props.cancelText ?? "取消"}
          </button>
          <button
            onClick={props.onConfirm}
            style={{
              background: confirmColor,
              border: "none",
              "border-radius": "8px",
              color: "white",
              padding: "8px 18px",
              cursor: "pointer",
              "font-size": "14px",
              "font-weight": "500",
            }}
          >
            {props.confirmText ?? "确认"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== 通用媒体管理页 ====================
interface MediaManagePageProps {
  mediaType: MediaType
  title: string
  icon: string
}

export const MediaManagePage = (props: MediaManagePageProps) => {
  // Toast 通知
  const [toast, setToast] = createSignal<{
    message: string
    type: "success" | "error" | "warning" | "info"
  } | null>(null)
  const showToast = (
    message: string,
    type: "success" | "error" | "warning" | "info" = "success",
  ) => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  // 确认弹窗
  const [confirmDialog, setConfirmDialog] =
    createSignal<ConfirmDialogProps | null>(null)
  const showConfirm = (opts: Omit<ConfirmDialogProps, "onCancel">) =>
    new Promise<boolean>((resolve) => {
      setConfirmDialog({
        ...opts,
        onCancel: () => {
          setConfirmDialog(null)
          resolve(false)
        },
        onConfirm: () => {
          setConfirmDialog(null)
          opts.onConfirm()
          resolve(true)
        },
      })
    })

  // 配置状态
  const [config, setConfig] = createSignal<MediaConfig>({
    media_type: props.mediaType,
    enabled: false,
    last_scan_at: null,
    last_scrape_at: null,
  })
  const [configSaving, setConfigSaving] = createSignal(false)

  // 扫描路径状态
  const [scanPaths, setScanPaths] = createSignal<MediaScanPath[]>([])
  const [showScanPathModal, setShowScanPathModal] = createSignal(false)
  const [editingScanPath, setEditingScanPath] =
    createSignal<Partial<MediaScanPath> | null>(null)
  const [scanPathSaving, setScanPathSaving] = createSignal(false)

  // 扫描/刮削状态
  const [scanning, setScanning] = createSignal(false)
  const [scraping, setScraping] = createSignal(false)
  const [progress, setProgress] = createSignal<{
    status: string
    current: number
    total: number
  } | null>(null)

  // 数据库管理状态
  const [page, setPage] = createSignal(1)
  const [pageSize, setPageSize] = createSignal(
    props.mediaType === "image" ? 25 : 10,
  )
  const [filterScanPathId, setFilterScanPathId] = createSignal<number>(0)
  const [filterKeyword, setFilterKeyword] = createSignal("")
  const [searchInput, setSearchInput] = createSignal("")
  const [editingItem, setEditingItem] = createSignal<MediaItem | null>(null)
  const [showEditModal, setShowEditModal] = createSignal(false)

  // 搜索防抖
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  const handleSearchInput = (value: string) => {
    setSearchInput(value)
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      setFilterKeyword(value)
      setPage(1)
    }, 500)
  }
  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer)
  })

  // 加载配置
  const [configData] = createResource(
    () => props.mediaType,
    async (mt) => {
      const resp = await adminGetMediaConfigs()
      if (resp.code === 200) {
        const found = (resp.data as MediaConfig[]).find(
          (c) => c.media_type === mt,
        )
        if (found) setConfig(found)
      }
      return null
    },
  )

  // 加载扫描路径
  const loadScanPaths = async () => {
    const resp = await adminListMediaScanPaths(props.mediaType)
    if (resp.code === 200) setScanPaths(resp.data as MediaScanPath[])
  }
  createEffect(() => {
    if (props.mediaType) loadScanPaths()
  })

  // 加载媒体条目
  const [itemsData, { refetch: refetchItems }] = createResource(
    () => ({
      media_type: props.mediaType,
      page: page(),
      page_size: pageSize(),
      scan_path_id: filterScanPathId() || undefined,
      keyword: filterKeyword() || undefined,
    }),
    async (params) => {
      const resp = await adminGetMediaItems(params)
      if (resp.code === 200) return resp.data
      return { content: [], total: 0 }
    },
  )

  const items = () => (itemsData()?.content as MediaItem[]) ?? []
  const total = () => itemsData()?.total ?? 0
  const totalPages = () => Math.ceil(total() / pageSize())

  // 保存配置
  const handleSaveConfig = async () => {
    setConfigSaving(true)
    const resp = await adminSaveMediaConfig(config())
    setConfigSaving(false)
    if (resp.code === 200) showToast("配置保存成功")
    else showToast("保存失败: " + resp.message, "error")
  }

  // 扫描路径操作
  const handleOpenCreateScanPath = () => {
    setEditingScanPath({
      media_type: props.mediaType,
      name: "",
      path: "/",
      path_merge: false,
      type_tag: "",
      content_tags: "",
      enable_scrape: true,
    })
    setShowScanPathModal(true)
  }

  const handleOpenEditScanPath = (sp: MediaScanPath) => {
    setEditingScanPath({ ...sp })
    setShowScanPathModal(true)
  }

  const handleSaveScanPath = async () => {
    const sp = editingScanPath()
    if (!sp) return
    setScanPathSaving(true)
    let resp
    if (sp.id) {
      resp = await adminUpdateMediaScanPath(
        sp as MediaScanPath & { id: number },
      )
    } else {
      resp = await adminCreateMediaScanPath(sp)
    }
    setScanPathSaving(false)
    if (resp.code === 200) {
      showToast(sp.id ? "扫描路径已更新" : "扫描路径已创建")
      setShowScanPathModal(false)
      setEditingScanPath(null)
      await loadScanPaths()
    } else {
      showToast("操作失败: " + resp.message, "error")
    }
  }

  const handleDeleteScanPath = async (sp: MediaScanPath) => {
    showConfirm({
      title: "删除扫描路径",
      message: `确定要删除扫描路径「${sp.name || sp.path}」吗？此操作不会删除已扫描的媒体数据。`,
      confirmText: "删除",
      type: "danger",
      onConfirm: async () => {
        const resp = await adminDeleteMediaScanPath(sp.id!)
        if (resp.code === 200) {
          showToast("扫描路径已删除")
          await loadScanPaths()
        } else {
          showToast("删除失败: " + resp.message, "error")
        }
      },
    })
  }

  const handleClearScanPathDB = async (sp: MediaScanPath) => {
    showConfirm({
      title: "清空路径数据",
      message: `确定要清空「${sp.name || sp.path}」下的所有媒体数据吗？此操作不可恢复！`,
      confirmText: "清空",
      type: "danger",
      onConfirm: async () => {
        const resp = await adminClearMediaScanPathDB(sp.id!)
        if (resp.code === 200) {
          showToast("路径数据已清空")
          refetchItems()
        } else {
          showToast("清空失败: " + resp.message, "error")
        }
      },
    })
  }

  // 扫描单个路径
  const handleScanPath = async (sp: MediaScanPath) => {
    if (!config().enabled) {
      showToast("请先启用该媒体库", "warning")
      return
    }
    setScanning(true)
    setProgress({ status: "扫描中...", current: 0, total: 0 })
    await adminStartMediaScan(props.mediaType, sp.id)
    const timer = setInterval(async () => {
      const resp = await adminGetMediaScanProgress(props.mediaType)
      if (resp.code === 200 && resp.data) {
        const d = resp.data
        setProgress({
          status: d.message || (d.running ? "扫描中..." : "完成"),
          current: d.done,
          total: d.total,
        })
        if (!d.running) {
          clearInterval(timer)
          setScanning(false)
          refetchItems()
          showToast("扫描完成")
        }
      }
    }, 1000)
  }

  // 扫描全部
  const handleScanAll = async () => {
    if (!config().enabled) {
      showToast("请先启用该媒体库", "warning")
      return
    }
    setScanning(true)
    setProgress({ status: "扫描中...", current: 0, total: 0 })
    await adminStartMediaScan(props.mediaType)
    const timer = setInterval(async () => {
      const resp = await adminGetMediaScanProgress(props.mediaType)
      if (resp.code === 200 && resp.data) {
        const d = resp.data
        setProgress({
          status: d.message || (d.running ? "扫描中..." : "完成"),
          current: d.done,
          total: d.total,
        })
        if (!d.running) {
          clearInterval(timer)
          setScanning(false)
          refetchItems()
          showToast("扫描完成")
        }
      }
    }, 1000)
  }

  // 刮削
  const handleScrape = async () => {
    setScraping(true)
    const resp = await adminStartMediaScrape(props.mediaType)
    setScraping(false)
    if (resp.code === 200) {
      showToast("刮削任务已启动，请稍后刷新查看结果", "info")
      refetchItems()
    } else {
      showToast("刮削失败: " + resp.message, "error")
    }
  }

  // 清空整个媒体库
  const handleClearAll = async () => {
    showConfirm({
      title: `清空 ${props.title} 数据库`,
      message: `确定要清空 ${props.title} 的所有媒体数据吗？此操作不可恢复！`,
      confirmText: "清空全部",
      type: "danger",
      onConfirm: async () => {
        const resp = await adminClearMediaDB(props.mediaType)
        if (resp.code === 200) {
          showToast("数据库已清空")
          refetchItems()
        } else {
          showToast("清空失败: " + resp.message, "error")
        }
      },
    })
  }

  // 保存编辑
  const handleSaveItem = async () => {
    if (!editingItem()) return
    const resp = await adminUpdateMediaItem(editingItem()!)
    if (resp.code === 200) {
      showToast("保存成功")
      setShowEditModal(false)
      setEditingItem(null)
      refetchItems()
    } else {
      showToast("保存失败: " + resp.message, "error")
    }
  }

  // 删除条目
  const handleDeleteItem = async (id: number, name: string) => {
    showConfirm({
      title: "删除媒体条目",
      message: `确定删除「${name}」吗？`,
      confirmText: "删除",
      type: "danger",
      onConfirm: async () => {
        const resp = await adminDeleteMediaItem(id)
        if (resp.code === 200) {
          showToast("已删除")
          refetchItems()
        } else {
          showToast("删除失败: " + resp.message, "error")
        }
      },
    })
  }

  const getScanPathName = (id: number) => {
    const sp = scanPaths().find((p) => p.id === id)
    return sp ? sp.name || sp.path : "-"
  }

  return (
    <div style={{ padding: "24px", "max-width": "1300px" }}>
      {/* CSS 动画 */}
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Toast 通知 */}
      <Show when={toast()}>
        <Toast
          message={toast()!.message}
          type={toast()!.type}
          onClose={() => setToast(null)}
        />
      </Show>

      {/* 确认弹窗 */}
      <Show when={confirmDialog()}>
        <ConfirmDialog {...confirmDialog()!} />
      </Show>

      {/* 页面标题 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          "margin-bottom": "24px",
        }}
      >
        <span style={{ "font-size": "28px" }}>{props.icon}</span>
        <div>
          <h2
            style={{
              margin: "0",
              "font-size": "20px",
              "font-weight": "700",
              color: "#111827",
            }}
          >
            {props.title}管理
          </h2>
          <p
            style={{ margin: "2px 0 0", "font-size": "13px", color: "#9ca3af" }}
          >
            管理媒体库配置、扫描路径和媒体数据
          </p>
        </div>
      </div>

      {/* 基础配置卡片 */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span
            style={{
              "font-size": "15px",
              "font-weight": "600",
              color: "#374151",
            }}
          >
            基础配置
          </span>
        </div>
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            "align-items": "center",
            gap: "20px",
            "flex-wrap": "wrap",
          }}
        >
          {/* 启用开关 */}
          <label
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              cursor: "pointer",
            }}
          >
            <span style={{ "font-size": "14px", color: "#374151" }}>
              启用媒体库
            </span>
            <div
              onClick={() => setConfig((c) => ({ ...c, enabled: !c.enabled }))}
              style={{
                width: "44px",
                height: "24px",
                "border-radius": "12px",
                background: config().enabled ? "#6366f1" : "#d1d5db",
                position: "relative",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  left: config().enabled ? "22px" : "2px",
                  width: "20px",
                  height: "20px",
                  "border-radius": "50%",
                  background: "white",
                  transition: "left 0.2s",
                  "box-shadow": "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </div>
          </label>

          <div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap" }}>
            <button
              onClick={handleSaveConfig}
              disabled={configSaving()}
              style={btnStyle("#6366f1")}
            >
              {configSaving() ? "保存中..." : "💾 保存配置"}
            </button>
            <button
              onClick={handleScanAll}
              disabled={scanning()}
              style={btnStyle("#10b981")}
            >
              {scanning() ? "扫描中..." : "🔍 扫描全部"}
            </button>
            <button
              onClick={handleScrape}
              disabled={scraping()}
              style={btnStyle("#f59e0b")}
            >
              {scraping() ? "刮削中..." : "✨ 立即刮削"}
            </button>
            <button onClick={handleClearAll} style={btnStyle("#ef4444")}>
              🗑️ 清空全部
            </button>
          </div>
        </div>

        {/* 扫描进度 */}
        <Show when={progress()}>
          <div style={{ padding: "0 20px 16px" }}>
            <div
              style={{
                padding: "10px 14px",
                background: "#f0fdf4",
                "border-radius": "8px",
                "font-size": "13px",
                color: "#166534",
                border: "1px solid #bbf7d0",
              }}
            >
              {progress()?.status}
              <Show when={(progress()?.total ?? 0) > 0}>
                {" "}
                ({progress()?.current} / {progress()?.total})
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* 扫描路径管理 */}
      <div style={{ ...cardStyle, "margin-top": "20px" }}>
        <div
          style={{
            ...cardHeaderStyle,
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
          }}
        >
          <span
            style={{
              "font-size": "15px",
              "font-weight": "600",
              color: "#374151",
            }}
          >
            扫描路径（{scanPaths().length} 个）
          </span>
          <button
            onClick={handleOpenCreateScanPath}
            style={btnStyle("#6366f1", "small")}
          >
            + 添加路径
          </button>
        </div>

        <div style={{ "overflow-x": "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {[
                  "路径名称",
                  "扫描路径",
                  "类型标签",
                  "内容标签",
                  "路径合并",
                  "刮削",
                  "最后扫描",
                  "操作",
                ].map((h) => (
                  <th style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Show
                when={scanPaths().length > 0}
                fallback={
                  <tr>
                    <td
                      colspan="8"
                      style={{
                        "text-align": "center",
                        padding: "32px",
                        color: "#9ca3af",
                        "font-size": "14px",
                      }}
                    >
                      暂无扫描路径，点击「添加路径」开始配置
                    </td>
                  </tr>
                }
              >
                <For each={scanPaths()}>
                  {(sp) => (
                    <tr
                      style={{ "border-bottom": "1px solid #f1f5f9" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#f8fafc"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent"
                      }}
                    >
                      <td style={tdStyle}>
                        <span
                          style={{ "font-weight": "500", color: "#374151" }}
                        >
                          {sp.name || "-"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <code
                          style={{
                            "font-size": "12px",
                            background: "#f1f5f9",
                            padding: "2px 6px",
                            "border-radius": "4px",
                            color: "#475569",
                          }}
                        >
                          {sp.path}
                        </code>
                      </td>
                      <td style={tdStyle}>
                        <Show when={sp.type_tag}>
                          <span style={tagStyle("#dbeafe", "#1d4ed8")}>
                            {sp.type_tag}
                          </span>
                        </Show>
                      </td>
                      <td style={{ ...tdStyle, "max-width": "160px" }}>
                        <div
                          style={{
                            display: "flex",
                            "flex-wrap": "wrap",
                            gap: "4px",
                          }}
                        >
                          <For
                            each={(sp.content_tags || "")
                              .split(",")
                              .filter(Boolean)}
                          >
                            {(tag) => (
                              <span style={tagStyle("#f3e8ff", "#7c3aed")}>
                                {tag.trim()}
                              </span>
                            )}
                          </For>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            color: sp.path_merge ? "#10b981" : "#9ca3af",
                            "font-size": "13px",
                          }}
                        >
                          {sp.path_merge ? "✓ 是" : "否"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            color: sp.enable_scrape ? "#10b981" : "#9ca3af",
                            "font-size": "13px",
                          }}
                        >
                          {sp.enable_scrape ? "✓ 是" : "否"}
                        </span>
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          "white-space": "nowrap",
                          color: "#9ca3af",
                          "font-size": "12px",
                        }}
                      >
                        {sp.last_scan_at
                          ? new Date(sp.last_scan_at).toLocaleString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "从未"}
                      </td>
                      <td style={tdStyle}>
                        <div
                          style={{
                            display: "flex",
                            gap: "6px",
                            "flex-wrap": "nowrap",
                          }}
                        >
                          <button
                            onClick={() => handleScanPath(sp)}
                            disabled={scanning()}
                            style={actionBtnStyle("#eff6ff", "#3b82f6")}
                          >
                            扫描
                          </button>
                          <button
                            onClick={() => handleOpenEditScanPath(sp)}
                            style={actionBtnStyle("#f0fdf4", "#10b981")}
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleClearScanPathDB(sp)}
                            style={actionBtnStyle("#fffbeb", "#f59e0b")}
                          >
                            清空
                          </button>
                          <button
                            onClick={() => handleDeleteScanPath(sp)}
                            style={actionBtnStyle("#fef2f2", "#ef4444")}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>

      {/* 数据库管理 */}
      <div style={{ ...cardStyle, "margin-top": "20px" }}>
        <div
          style={{
            ...cardHeaderStyle,
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "flex-wrap": "wrap",
            gap: "10px",
          }}
        >
          <span
            style={{
              "font-size": "15px",
              "font-weight": "600",
              color: "#374151",
            }}
          >
            数据库管理（共 {total()} 条）
          </span>
          {/* 筛选工具栏 */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              "align-items": "center",
              "flex-wrap": "wrap",
            }}
          >
            <select
              value={filterScanPathId()}
              onChange={(e) => {
                setFilterScanPathId(Number(e.currentTarget.value))
                setPage(1)
              }}
              style={selectStyle}
            >
              <option value="0">全部路径</option>
              <For each={scanPaths()}>
                {(sp) => <option value={sp.id}>{sp.name || sp.path}</option>}
              </For>
            </select>
            <input
              type="text"
              placeholder="搜索名称..."
              value={searchInput()}
              onInput={(e) => handleSearchInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (searchTimer) clearTimeout(searchTimer)
                  setFilterKeyword(searchInput())
                  setPage(1)
                }
              }}
              style={{ ...inputStyle, width: "160px" }}
            />
            <div
              style={{ display: "flex", "align-items": "center", gap: "6px" }}
            >
              <span
                style={{
                  "font-size": "13px",
                  color: "#6b7280",
                  "white-space": "nowrap",
                }}
              >
                每页
              </span>
              <select
                value={pageSize()}
                onChange={(e) => {
                  setPageSize(Number(e.currentTarget.value))
                  setPage(1)
                }}
                style={{
                  ...selectStyle,
                  width: props.mediaType === "image" ? "72px" : "64px",
                }}
              >
                {props.mediaType === "image" ? (
                  <>
                    <option value="15">15</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="75">75</option>
                    <option value="100">100</option>
                  </>
                ) : (
                  <>
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="20">20</option>
                  </>
                )}
              </select>
              <span style={{ "font-size": "13px", color: "#6b7280" }}>
                {props.mediaType === "image" ? "张" : "条"}
              </span>
            </div>
          </div>
        </div>

        <div style={{ "overflow-x": "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {[
                  "文件名",
                  "名称",
                  "封面",
                  "扫描路径",
                  "发布时间",
                  "评分",
                  "隐藏",
                  "操作",
                ].map((h) => (
                  <th style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Show
                when={!itemsData.loading}
                fallback={
                  <tr>
                    <td
                      colspan="8"
                      style={{
                        "text-align": "center",
                        padding: "40px",
                        color: "#9ca3af",
                      }}
                    >
                      加载中...
                    </td>
                  </tr>
                }
              >
                <For each={items()}>
                  {(item) => (
                    <tr
                      style={{ "border-bottom": "1px solid #f1f5f9" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#f8fafc"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent"
                      }}
                    >
                      <td style={{ ...tdStyle, "max-width": "180px" }}>
                        <div
                          style={{
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                            color: "#374151",
                            "font-size": "12px",
                          }}
                          title={item.file_name}
                        >
                          {item.file_name}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, "max-width": "160px" }}>
                        <div
                          style={{
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                            color: "#374151",
                            "font-weight": "500",
                          }}
                        >
                          {item.scraped_name || item.file_name}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <Show when={item.cover}>
                          <img
                            src={item.cover}
                            style={{
                              width: "32px",
                              height: "44px",
                              "object-fit": "cover",
                              "border-radius": "4px",
                            }}
                          />
                        </Show>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ "font-size": "12px", color: "#6b7280" }}>
                          {getScanPathName(item.scan_path_id)}
                        </span>
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          "white-space": "nowrap",
                          color: "#6b7280",
                          "font-size": "12px",
                        }}
                      >
                        {item.release_date?.slice(0, 10) || "-"}
                      </td>
                      <td style={{ ...tdStyle, color: "#6b7280" }}>
                        {item.rating > 0 ? item.rating.toFixed(1) : "-"}
                      </td>
                      <td style={tdStyle}>
                        <div
                          onClick={async () => {
                            await adminUpdateMediaItem({
                              ...item,
                              hidden: !item.hidden,
                            })
                            refetchItems()
                          }}
                          style={{
                            width: "36px",
                            height: "20px",
                            "border-radius": "10px",
                            background: item.hidden ? "#6366f1" : "#d1d5db",
                            position: "relative",
                            cursor: "pointer",
                            transition: "background 0.2s",
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              top: "2px",
                              left: item.hidden ? "18px" : "2px",
                              width: "16px",
                              height: "16px",
                              "border-radius": "50%",
                              background: "white",
                              transition: "left 0.2s",
                            }}
                          />
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => {
                              setEditingItem({ ...item })
                              setShowEditModal(true)
                            }}
                            style={actionBtnStyle("#eff6ff", "#3b82f6")}
                          >
                            编辑
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteItem(
                                item.id,
                                item.scraped_name || item.file_name,
                              )
                            }
                            style={actionBtnStyle("#fef2f2", "#ef4444")}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <Show when={total() > 0}>
          <div
            style={{
              display: "flex",
              "justify-content": "center",
              "align-items": "center",
              gap: "8px",
              padding: "16px",
              "border-top": "1px solid #f1f5f9",
            }}
          >
            <button
              disabled={page() <= 1}
              onClick={() => setPage(1)}
              style={{ ...pageBtnStyle, opacity: page() <= 1 ? "0.4" : "1" }}
            >
              «
            </button>
            <button
              disabled={page() <= 1}
              onClick={() => setPage(page() - 1)}
              style={{ ...pageBtnStyle, opacity: page() <= 1 ? "0.4" : "1" }}
            >
              上一页
            </button>
            <span
              style={{
                color: "#6b7280",
                "font-size": "13px",
                padding: "0 4px",
                "white-space": "nowrap",
              }}
            >
              第 {page()} / {totalPages()} 页，共 {total()} 条
            </span>
            <button
              disabled={page() >= totalPages()}
              onClick={() => setPage(page() + 1)}
              style={{
                ...pageBtnStyle,
                opacity: page() >= totalPages() ? "0.4" : "1",
              }}
            >
              下一页
            </button>
            <button
              disabled={page() >= totalPages()}
              onClick={() => setPage(totalPages())}
              style={{
                ...pageBtnStyle,
                opacity: page() >= totalPages() ? "0.4" : "1",
              }}
            >
              »
            </button>
          </div>
        </Show>
      </div>

      {/* 扫描路径编辑弹窗 */}
      <Show when={showScanPathModal() && editingScanPath()}>
        <div
          style={modalOverlayStyle}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowScanPathModal(false)
          }}
        >
          <div style={{ ...modalStyle, width: "520px" }}>
            <h3 style={modalTitleStyle}>
              {editingScanPath()?.id ? "编辑扫描路径" : "添加扫描路径"}
            </h3>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "16px",
              }}
            >
              <FormField label="路径名称" hint="用于前端筛选显示">
                <input
                  type="text"
                  placeholder="如：电影库、音乐收藏"
                  value={editingScanPath()?.name ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      name: e.currentTarget.value,
                    }))
                  }
                  style={inputStyle}
                />
              </FormField>
              <FormField label="扫描路径" hint="VFS 虚拟路径，如 /movies">
                <input
                  type="text"
                  placeholder="/movies"
                  value={editingScanPath()?.path ?? "/"}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      path: e.currentTarget.value,
                    }))
                  }
                  style={inputStyle}
                />
              </FormField>
              <FormField
                label="类型标签"
                hint="如：电影、电视剧（用于前端筛选）"
              >
                <input
                  type="text"
                  placeholder="电影"
                  value={editingScanPath()?.type_tag ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      type_tag: e.currentTarget.value,
                    }))
                  }
                  style={inputStyle}
                />
              </FormField>
              <FormField
                label="内容标签"
                hint="多个标签用英文逗号分隔，如：喜剧,惊悚"
              >
                <input
                  type="text"
                  placeholder="喜剧,惊悚,动作"
                  value={editingScanPath()?.content_tags ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      content_tags: e.currentTarget.value,
                    }))
                  }
                  style={inputStyle}
                />
              </FormField>
              <div style={{ display: "flex", gap: "24px" }}>
                <ToggleField
                  label="路径合并模式"
                  hint="子文件夹作为一个条目"
                  value={editingScanPath()?.path_merge ?? false}
                  onChange={(v) =>
                    setEditingScanPath((sp) => ({ ...sp!, path_merge: v }))
                  }
                />
                <ToggleField
                  label="启用刮削"
                  hint="扫描后自动刮削元数据"
                  value={editingScanPath()?.enable_scrape ?? true}
                  onChange={(v) =>
                    setEditingScanPath((sp) => ({ ...sp!, enable_scrape: v }))
                  }
                />
              </div>
            </div>
            <div style={modalFooterStyle}>
              <button
                onClick={() => setShowScanPathModal(false)}
                style={cancelBtnStyle}
              >
                取消
              </button>
              <button
                onClick={handleSaveScanPath}
                disabled={scanPathSaving()}
                style={confirmBtnStyle("#6366f1")}
              >
                {scanPathSaving() ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 媒体条目编辑弹窗 */}
      <Show when={showEditModal() && editingItem()}>
        <div
          style={modalOverlayStyle}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEditModal(false)
          }}
        >
          <div style={{ ...modalStyle, width: "560px" }}>
            <h3 style={modalTitleStyle}>编辑媒体信息</h3>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "14px",
              }}
            >
              {[
                { key: "scraped_name", label: "名称" },
                { key: "cover", label: "封面URL" },
                { key: "release_date", label: "发布时间 (YYYY-MM-DD)" },
                { key: "genre", label: "类型（逗号分隔）" },
                { key: "authors", label: "作者/演员（JSON数组）" },
              ].map(({ key, label }) => (
                <FormField label={label}>
                  <input
                    type="text"
                    value={(editingItem() as any)?.[key] ?? ""}
                    onInput={(e) =>
                      setEditingItem((item) => ({
                        ...item!,
                        [key]: e.currentTarget.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </FormField>
              ))}
              <FormField label="评分 (0-10)">
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={editingItem()?.rating ?? 0}
                  onInput={(e) =>
                    setEditingItem((item) => ({
                      ...item!,
                      rating: parseFloat(e.currentTarget.value),
                    }))
                  }
                  style={inputStyle}
                />
              </FormField>
              <FormField label="简介">
                <textarea
                  value={editingItem()?.description ?? ""}
                  onInput={(e) =>
                    setEditingItem((item) => ({
                      ...item!,
                      description: e.currentTarget.value,
                    }))
                  }
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </FormField>
            </div>
            <div style={modalFooterStyle}>
              <button
                onClick={() => setShowEditModal(false)}
                style={cancelBtnStyle}
              >
                取消
              </button>
              <button
                onClick={handleSaveItem}
                style={confirmBtnStyle("#6366f1")}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

// ==================== 辅助组件 ====================
const FormField = (props: { label: string; hint?: string; children: any }) => (
  <div>
    <label
      style={{
        display: "block",
        "font-size": "13px",
        "font-weight": "500",
        color: "#374151",
        "margin-bottom": "4px",
      }}
    >
      {props.label}
      <Show when={props.hint}>
        <span
          style={{
            "font-weight": "400",
            color: "#9ca3af",
            "margin-left": "6px",
            "font-size": "12px",
          }}
        >
          {props.hint}
        </span>
      </Show>
    </label>
    {props.children}
  </div>
)

const ToggleField = (props: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) => (
  <div>
    <label
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        cursor: "pointer",
      }}
    >
      <div
        onClick={() => props.onChange(!props.value)}
        style={{
          width: "40px",
          height: "22px",
          "border-radius": "11px",
          background: props.value ? "#6366f1" : "#d1d5db",
          position: "relative",
          cursor: "pointer",
          transition: "background 0.2s",
          "flex-shrink": "0",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "2px",
            left: props.value ? "20px" : "2px",
            width: "18px",
            height: "18px",
            "border-radius": "50%",
            background: "white",
            transition: "left 0.2s",
            "box-shadow": "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </div>
      <div>
        <div
          style={{
            "font-size": "13px",
            "font-weight": "500",
            color: "#374151",
          }}
        >
          {props.label}
        </div>
        <Show when={props.hint}>
          <div style={{ "font-size": "11px", color: "#9ca3af" }}>
            {props.hint}
          </div>
        </Show>
      </div>
    </label>
  </div>
)

// ==================== 样式常量 ====================
const cardStyle = {
  background: "white",
  "border-radius": "12px",
  "box-shadow": "0 1px 3px rgba(0,0,0,0.08)",
  border: "1px solid #e2e8f0",
  overflow: "hidden",
}

const cardHeaderStyle = {
  padding: "14px 20px",
  "border-bottom": "1px solid #f1f5f9",
  background: "#fafafa",
}

const tableStyle = {
  width: "100%",
  "border-collapse": "collapse",
  "font-size": "13px",
}

const thStyle = {
  padding: "10px 12px",
  "text-align": "left" as const,
  color: "#6b7280",
  "font-weight": "500",
  "white-space": "nowrap" as const,
  "border-bottom": "1px solid #e2e8f0",
}

const tdStyle = {
  padding: "10px 12px",
}

const btnStyle = (color: string, size?: "small") => ({
  background: color,
  border: "none",
  "border-radius": "8px",
  color: "white",
  padding: size === "small" ? "6px 12px" : "8px 16px",
  "font-size": size === "small" ? "12px" : "13px",
  "font-weight": "500",
  cursor: "pointer",
})

const actionBtnStyle = (bg: string, color: string) => ({
  background: bg,
  border: `1px solid ${color}22`,
  "border-radius": "5px",
  color: color,
  padding: "3px 8px",
  "font-size": "12px",
  cursor: "pointer",
  "white-space": "nowrap" as const,
})

const tagStyle = (bg: string, color: string) => ({
  background: bg,
  color: color,
  "border-radius": "4px",
  padding: "2px 6px",
  "font-size": "11px",
  "font-weight": "500",
  "white-space": "nowrap" as const,
})

const selectStyle = {
  border: "1px solid #d1d5db",
  "border-radius": "6px",
  padding: "5px 8px",
  "font-size": "13px",
  color: "#374151",
  background: "white",
  outline: "none",
}

const inputStyle = {
  width: "100%",
  border: "1px solid #d1d5db",
  "border-radius": "6px",
  padding: "7px 10px",
  "font-size": "13px",
  outline: "none",
  "box-sizing": "border-box" as const,
  color: "#374151",
}

const pageBtnStyle = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  "border-radius": "6px",
  color: "#374151",
  padding: "5px 12px",
  cursor: "pointer",
  "font-size": "13px",
}

const modalOverlayStyle = {
  position: "fixed" as const,
  inset: "0",
  background: "rgba(0,0,0,0.5)",
  "z-index": "500",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "backdrop-filter": "blur(4px)",
}

const modalStyle = {
  background: "white",
  "border-radius": "16px",
  padding: "28px",
  "max-width": "90vw",
  "max-height": "85vh",
  "overflow-y": "auto" as const,
  "box-shadow": "0 25px 60px rgba(0,0,0,0.25)",
  animation: "fadeIn 0.2s ease",
}

const modalTitleStyle = {
  margin: "0 0 20px",
  "font-size": "17px",
  "font-weight": "600",
  color: "#111827",
}

const modalFooterStyle = {
  display: "flex",
  gap: "10px",
  "margin-top": "24px",
  "justify-content": "flex-end",
}

const cancelBtnStyle = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  "border-radius": "8px",
  color: "#374151",
  padding: "8px 18px",
  cursor: "pointer",
  "font-size": "14px",
}

const confirmBtnStyle = (color: string) => ({
  background: color,
  border: "none",
  "border-radius": "8px",
  color: "white",
  padding: "8px 18px",
  cursor: "pointer",
  "font-size": "14px",
  "font-weight": "500",
})

// ==================== 4个具体管理页 ====================

export const VideoManage = () => (
  <MediaManagePage mediaType="video" title="影视" icon="🎬" />
)

export const MusicManage = () => (
  <MediaManagePage mediaType="music" title="音乐" icon="🎵" />
)

export const ImageManage = () => (
  <MediaManagePage mediaType="image" title="图片" icon="🖼️" />
)

export const BookManage = () => (
  <MediaManagePage mediaType="book" title="书籍" icon="📚" />
)
