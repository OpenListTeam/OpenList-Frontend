import { createSignal, createResource, Show, createEffect } from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { createMemo } from "solid-js"
import { MediaLayout } from "./MediaLayout"
import { adminGetMediaConfigs, adminSaveMediaConfig } from "~/utils/media_api"
import type { MediaConfig } from "~/types"

// ==================== 媒体库设置页 ====================
const MediaSettings = () => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")

  // 主题色
  const cardBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.9)",
  )
  const cardBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
  )
  const titleColor = createMemo(() => (isDark() ? "#f1f5f9" : "#0f172a"))
  const labelColor = createMemo(() => (isDark() ? "#94a3b8" : "#374151"))
  const subColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const inputBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "white",
  )
  const inputBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.12)" : "#d1d5db",
  )
  const inputColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const sectionBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
  )
  const sectionBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
  )

  // 图片配置
  const [imageThumbnailMode, setImageThumbnailMode] = createSignal<
    "base64" | "local"
  >("base64")
  const [imageThumbnailPath, setImageThumbnailPath] =
    createSignal("/.thumbnail")
  const [imageStoreThumbnail, setImageStoreThumbnail] = createSignal(false)

  // 图书配置
  const [bookThumbnailMode, setBookThumbnailMode] = createSignal<
    "base64" | "local"
  >("base64")
  const [bookThumbnailPath, setBookThumbnailPath] = createSignal("/.thumbnail")

  const [saving, setSaving] = createSignal(false)
  const [saveMsg, setSaveMsg] = createSignal("")

  // 加载配置
  const [configData] = createResource(async () => {
    const resp = await adminGetMediaConfigs()
    if (resp.code === 200) return resp.data as MediaConfig[]
    return []
  })

  // 配置加载后初始化状态
  createEffect(() => {
    const configs = configData()
    if (!configs) return
    const imageConfig = configs.find((c) => c.media_type === "image")
    const bookConfig = configs.find((c) => c.media_type === "book")

    if (imageConfig) {
      try {
        const sc = JSON.parse(imageConfig.scraper_config || "{}")
        setImageStoreThumbnail(sc.store_thumbnail === "true")
        setImageThumbnailMode(
          (sc.thumbnail_mode as "base64" | "local") || "base64",
        )
        setImageThumbnailPath(sc.thumbnail_path || "/.thumbnail")
      } catch {}
    }
    if (bookConfig) {
      try {
        const sc = JSON.parse(bookConfig.scraper_config || "{}")
        setBookThumbnailMode(
          (sc.thumbnail_mode as "base64" | "local") || "base64",
        )
        setBookThumbnailPath(sc.thumbnail_path || "/.thumbnail")
      } catch {}
    }
  })

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg("")
    const configs = configData()
    if (!configs) {
      setSaving(false)
      return
    }

    try {
      // 保存图片配置
      const imageConfig = configs.find((c) => c.media_type === "image")
      if (imageConfig) {
        let sc: Record<string, string> = {}
        try {
          sc = JSON.parse(imageConfig.scraper_config || "{}")
        } catch {}
        sc.store_thumbnail = imageStoreThumbnail() ? "true" : "false"
        sc.thumbnail_mode = imageThumbnailMode()
        sc.thumbnail_path = imageThumbnailPath()
        await adminSaveMediaConfig({
          ...imageConfig,
          scraper_config: JSON.stringify(sc),
        })
      }

      // 保存图书配置
      const bookConfig = configs.find((c) => c.media_type === "book")
      if (bookConfig) {
        let sc: Record<string, string> = {}
        try {
          sc = JSON.parse(bookConfig.scraper_config || "{}")
        } catch {}
        sc.thumbnail_mode = bookThumbnailMode()
        sc.thumbnail_path = bookThumbnailPath()
        await adminSaveMediaConfig({
          ...bookConfig,
          scraper_config: JSON.stringify(sc),
        })
      }

      setSaveMsg("✅ 保存成功")
    } catch (e) {
      setSaveMsg("❌ 保存失败")
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(""), 3000)
    }
  }

  const ToggleSwitch = (p: {
    value: boolean
    onChange: (v: boolean) => void
    label: string
  }) => (
    <label
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        cursor: "pointer",
      }}
    >
      <div
        onClick={() => p.onChange(!p.value)}
        style={{
          width: "44px",
          height: "24px",
          "border-radius": "12px",
          background: p.value
            ? "#6366f1"
            : isDark()
              ? "rgba(255,255,255,0.15)"
              : "#d1d5db",
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
            left: p.value ? "22px" : "2px",
            width: "20px",
            height: "20px",
            "border-radius": "50%",
            background: "white",
            transition: "left 0.2s",
            "box-shadow": "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </div>
      <span style={{ "font-size": "14px", color: labelColor() }}>
        {p.label}
      </span>
    </label>
  )

  const ModeSelector = (p: {
    value: "base64" | "local"
    onChange: (v: "base64" | "local") => void
  }) => (
    <div style={{ display: "flex", gap: "6px" }}>
      {(["base64", "local"] as const).map((mode) => (
        <button
          onClick={() => p.onChange(mode)}
          style={{
            background:
              p.value === mode
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : isDark()
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.05)",
            border:
              p.value === mode
                ? "1px solid rgba(99,102,241,0.5)"
                : `1px solid ${isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)"}`,
            "border-radius": "8px",
            color: p.value === mode ? "white" : labelColor(),
            padding: "6px 16px",
            "font-size": "13px",
            cursor: "pointer",
            transition: "all 0.2s",
            "font-weight": p.value === mode ? "500" : "400",
          }}
        >
          {mode === "base64" ? "🗄️ BASE64（数据库）" : "📁 本地文件"}
        </button>
      ))}
    </div>
  )

  return (
    <MediaLayout title="⚙️ 媒体库设置">
      <Show
        when={!configData.loading}
        fallback={
          <div
            style={{
              "text-align": "center",
              padding: "60px",
              color: subColor(),
            }}
          >
            加载中...
          </div>
        }
      >
        <div style={{ "max-width": "720px" }}>
          <h2
            style={{
              margin: "0 0 6px",
              "font-size": "22px",
              "font-weight": "700",
              color: titleColor(),
            }}
          >
            ⚙️ 媒体库设置
          </h2>
          <p
            style={{
              margin: "0 0 28px",
              "font-size": "14px",
              color: subColor(),
            }}
          >
            配置缩略图/封面的存储方式，影响图片和图书的刮削行为。修改后需重新刮削才能生效。
          </p>

          {/* ── 图片设置 ── */}
          <div
            style={{
              background: cardBg(),
              "border-radius": "14px",
              border: `1px solid ${cardBorder()}`,
              padding: "24px",
              "margin-bottom": "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "10px",
                "margin-bottom": "20px",
              }}
            >
              <span style={{ "font-size": "22px" }}>🖼️</span>
              <h3
                style={{
                  margin: "0",
                  "font-size": "16px",
                  "font-weight": "600",
                  color: titleColor(),
                }}
              >
                图片库设置
              </h3>
            </div>

            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "20px",
              }}
            >
              {/* 存储缩略图开关 */}
              <div
                style={{
                  background: sectionBg(),
                  "border-radius": "10px",
                  border: `1px solid ${sectionBorder()}`,
                  padding: "16px",
                }}
              >
                <ToggleSwitch
                  value={imageStoreThumbnail()}
                  onChange={setImageStoreThumbnail}
                  label="存储缩略图"
                />
                <p
                  style={{
                    margin: "8px 0 0 54px",
                    "font-size": "12px",
                    color: subColor(),
                  }}
                >
                  开启后刮削时生成缩略图并存储；关闭则直接用原图路径作为封面
                </p>
              </div>

              {/* 存储方式（仅在开启时显示） */}
              <Show when={imageStoreThumbnail()}>
                <div
                  style={{
                    background: sectionBg(),
                    "border-radius": "10px",
                    border: `1px solid ${sectionBorder()}`,
                    padding: "16px",
                  }}
                >
                  <div style={{ "margin-bottom": "12px" }}>
                    <div
                      style={{
                        "font-size": "14px",
                        "font-weight": "500",
                        color: labelColor(),
                        "margin-bottom": "10px",
                      }}
                    >
                      缩略图存储方式
                    </div>
                    <ModeSelector
                      value={imageThumbnailMode()}
                      onChange={setImageThumbnailMode}
                    />
                    <p
                      style={{
                        margin: "8px 0 0",
                        "font-size": "12px",
                        color: subColor(),
                      }}
                    >
                      {imageThumbnailMode() === "base64"
                        ? "缩略图以 base64 编码存入数据库，无需额外文件存储，但会增大数据库体积"
                        : "缩略图保存为本地文件，数据库仅存储文件路径，节省数据库空间"}
                    </p>
                  </div>

                  {/* 本地存储路径 */}
                  <Show when={imageThumbnailMode() === "local"}>
                    <div
                      style={{
                        "border-top": `1px solid ${sectionBorder()}`,
                        "padding-top": "14px",
                        "margin-top": "4px",
                      }}
                    >
                      <div
                        style={{
                          "font-size": "14px",
                          "font-weight": "500",
                          color: labelColor(),
                          "margin-bottom": "8px",
                        }}
                      >
                        缩略图存储路径
                      </div>
                      <input
                        type="text"
                        value={imageThumbnailPath()}
                        onInput={(e) =>
                          setImageThumbnailPath(e.currentTarget.value)
                        }
                        placeholder="/.thumbnail"
                        style={{
                          background: inputBg(),
                          border: `1px solid ${inputBorder()}`,
                          "border-radius": "8px",
                          color: inputColor(),
                          padding: "8px 12px",
                          "font-size": "13px",
                          outline: "none",
                          width: "280px",
                          "font-family": "monospace",
                        }}
                      />
                      <p
                        style={{
                          margin: "6px 0 0",
                          "font-size": "12px",
                          color: subColor(),
                        }}
                      >
                        缩略图文件将保存到此 VFS 路径下，默认为{" "}
                        <code
                          style={{
                            "font-family": "monospace",
                            background: isDark()
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.06)",
                            padding: "1px 4px",
                            "border-radius": "3px",
                          }}
                        >
                          /.thumbnail
                        </code>
                      </p>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          {/* ── 图书设置 ── */}
          <div
            style={{
              background: cardBg(),
              "border-radius": "14px",
              border: `1px solid ${cardBorder()}`,
              padding: "24px",
              "margin-bottom": "28px",
            }}
          >
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "10px",
                "margin-bottom": "20px",
              }}
            >
              <span style={{ "font-size": "22px" }}>📚</span>
              <h3
                style={{
                  margin: "0",
                  "font-size": "16px",
                  "font-weight": "600",
                  color: titleColor(),
                }}
              >
                图书库设置
              </h3>
            </div>

            <div
              style={{
                background: sectionBg(),
                "border-radius": "10px",
                border: `1px solid ${sectionBorder()}`,
                padding: "16px",
              }}
            >
              <div style={{ "margin-bottom": "12px" }}>
                <div
                  style={{
                    "font-size": "14px",
                    "font-weight": "500",
                    color: labelColor(),
                    "margin-bottom": "10px",
                  }}
                >
                  封面存储方式
                </div>
                <ModeSelector
                  value={bookThumbnailMode()}
                  onChange={setBookThumbnailMode}
                />
                <p
                  style={{
                    margin: "8px 0 0",
                    "font-size": "12px",
                    color: subColor(),
                  }}
                >
                  {bookThumbnailMode() === "base64"
                    ? "封面以 base64 编码存入数据库（默认），无需额外文件存储，但会增大数据库体积"
                    : "封面保存为本地文件，数据库仅存储文件路径，节省数据库空间"}
                </p>
              </div>

              {/* 本地存储路径 */}
              <Show when={bookThumbnailMode() === "local"}>
                <div
                  style={{
                    "border-top": `1px solid ${sectionBorder()}`,
                    "padding-top": "14px",
                    "margin-top": "4px",
                  }}
                >
                  <div
                    style={{
                      "font-size": "14px",
                      "font-weight": "500",
                      color: labelColor(),
                      "margin-bottom": "8px",
                    }}
                  >
                    封面存储路径
                  </div>
                  <input
                    type="text"
                    value={bookThumbnailPath()}
                    onInput={(e) => setBookThumbnailPath(e.currentTarget.value)}
                    placeholder="/.thumbnail"
                    style={{
                      background: inputBg(),
                      border: `1px solid ${inputBorder()}`,
                      "border-radius": "8px",
                      color: inputColor(),
                      padding: "8px 12px",
                      "font-size": "13px",
                      outline: "none",
                      width: "280px",
                      "font-family": "monospace",
                    }}
                  />
                  <p
                    style={{
                      margin: "6px 0 0",
                      "font-size": "12px",
                      color: subColor(),
                    }}
                  >
                    封面文件将保存到此 VFS 路径下，默认为{" "}
                    <code
                      style={{
                        "font-family": "monospace",
                        background: isDark()
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(0,0,0,0.06)",
                        padding: "1px 4px",
                        "border-radius": "3px",
                      }}
                    >
                      /.thumbnail
                    </code>
                  </p>
                </div>
              </Show>
            </div>
          </div>

          {/* 保存按钮 */}
          <div
            style={{ display: "flex", "align-items": "center", gap: "14px" }}
          >
            <button
              onClick={handleSave}
              disabled={saving()}
              style={{
                background: saving()
                  ? isDark()
                    ? "rgba(99,102,241,0.4)"
                    : "#a5b4fc"
                  : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                border: "none",
                "border-radius": "10px",
                color: "white",
                padding: "10px 28px",
                "font-size": "14px",
                "font-weight": "600",
                cursor: saving() ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                "box-shadow": saving()
                  ? "none"
                  : "0 4px 14px rgba(99,102,241,0.4)",
              }}
            >
              {saving() ? "保存中..." : "💾 保存设置"}
            </button>
            <Show when={saveMsg()}>
              <span
                style={{
                  "font-size": "14px",
                  color: saveMsg().startsWith("✅") ? "#10b981" : "#ef4444",
                }}
              >
                {saveMsg()}
              </span>
            </Show>
          </div>

          {/* 说明 */}
          <div
            style={{
              "margin-top": "24px",
              padding: "14px 16px",
              background: isDark()
                ? "rgba(99,102,241,0.08)"
                : "rgba(99,102,241,0.05)",
              "border-radius": "10px",
              border: `1px solid ${isDark() ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.15)"}`,
            }}
          >
            <div
              style={{
                "font-size": "13px",
                "font-weight": "600",
                color: isDark() ? "#a5b4fc" : "#6366f1",
                "margin-bottom": "6px",
              }}
            >
              💡 说明
            </div>
            <ul
              style={{
                margin: "0",
                padding: "0 0 0 16px",
                "font-size": "13px",
                color: subColor(),
                "line-height": "1.8",
              }}
            >
              <li>修改存储方式后，需要重新刮削才能对已有数据生效</li>
              <li>
                BASE64
                模式：缩略图/封面直接存入数据库，访问速度快，但数据库体积较大
              </li>
              <li>
                本地文件模式：缩略图/封面保存为文件，数据库仅存路径，适合大量媒体文件
              </li>
              <li>
                本地存储路径支持 VFS 路径（如{" "}
                <code style={{ "font-family": "monospace" }}>/.thumbnail</code>
                ），需确保对应存储有写入权限
              </li>
            </ul>
          </div>
        </div>
      </Show>
    </MediaLayout>
  )
}

export default MediaSettings
