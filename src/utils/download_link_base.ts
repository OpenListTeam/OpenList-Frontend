/**
 * 解析「复制下载链接」使用的前缀。
 *
 * 只接受 http(s) 绝对地址，并去掉末尾斜杠；配置为空或格式非法时回退到
 * 当前站点地址（调用方传入的 fallback），保证未配置时行为与旧版本一致。
 * 配置值可包含子路径，例如 https://files.example.com/openlist。
 */
export const resolveDownloadLinkBase = (
  configured: string | undefined,
  fallback: string,
): string => {
  const base = (configured ?? "").trim().replace(/\/+$/, "")
  return /^https?:\/\/[^/\s]+/i.test(base) ? base : fallback
}
