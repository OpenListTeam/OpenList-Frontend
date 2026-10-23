/**
 * Hardware-Accelerated Custom Video Decoder
 * --------------------------------------------------------
 * 通过 mediabunny 的自定义解码器机制（registerDecoder）注入一个解码器，
 * 在原生 WebCodecs VideoDecoder 上额外指定：
 *   - hardwareAcceleration: 'prefer-hardware' （优先用 GPU 解码）
 *   - optimizeForLatency: true                （快速出帧，开播友好）
 *
 * --------------------------------------------------------
 * 重要的容错设计（必须遵守的不变量）：
 *
 * 【关键背景】mediabunny 调用 customDecoder.init() 是用 `void Promise.then(...)`，
 *  这意味着 init 抛错会被静默吞掉，但 mediabunny 仍把 customDecoder 视为已就绪。
 *  之后所有 decode() 调用都会被路由到这个"假死"的 decoder 上 —— 没有任何帧产出，
 *  播放器表现就是"前几帧后整体卡死"。
 *
 * 因此本实现的不变量：
 *   1. init() 永远不抛错。
 *   2. 如果 prefer-hardware 不被支持 → 自动降级到 no-preference (浏览器自由选择)。
 *   3. 即使 no-preference 也不支持 → 仍然 new VideoDecoder 但不 configure，让真实 decode
 *      调用产生明确错误事件，由 mediabunny 上层正常处理。
 *   4. supports() 只在最最基础不可用时才返回 false（如 VideoDecoder API 不存在）。
 */
import { CustomVideoDecoder, registerDecoder, VideoSample } from "mediabunny"

// 调试日志开关：默认关，由 setHardwareDecoderDebug(true) 打开
let _debug = false

// 注册标志（幂等）
let _registered = false

// 全局指标：记录硬件解码命中情况，方便用户在控制台查询
const _stats = {
  total: 0, // 总解码器实例数
  hardware: 0, // 真正走 prefer-hardware 的实例数
  fallback: 0, // 降级到 no-preference 的实例数
  failed: 0, // 完全无法 configure 的实例数
}

const log = (...args) => {
  if (_debug) console.log("[HardwareDecoder]", ...args)
}

// 本解码器只是在原生 WebCodecs 之上追加 prefer-hardware / optimizeForLatency，
// 因此只应该接管 WebCodecs 自己能处理的视频编解码器。
// 如果对任意 codec 都返回 true，mediabunny 会把 WebCodecs 无法 configure 的格式
// 也路由到这里；两边都失败后 init() 关闭解码器、decode() 静默丢帧，
// mediabunny 也不会再回退到它自己的解码实现。
const SUPPORTED_CODEC_PREFIXES = [
  "avc1",
  "avc3",
  "hvc1",
  "hev1",
  "vp8",
  "vp09",
  "av01",
]

class HardwareAcceleratedVideoDecoder extends CustomVideoDecoder {
  /**
   * mediabunny 通过该静态方法选择解码器。这是同步调用，
   * 所以这里只能做最基础的能力判断（不能 await isConfigSupported）。
   */
  static supports(codec, config) {
    if (typeof VideoDecoder === "undefined") return false
    if (!config || !config.codec) return false
    const name = String(config.codec).toLowerCase()
    return SUPPORTED_CODEC_PREFIXES.some((prefix) => name.startsWith(prefix))
  }

  /**
   * 初始化解码器。绝不抛错（详见文件头注释）。
   * 内部根据硬件支持情况，按优先级尝试：
   *   prefer-hardware → no-preference
   * 如果都失败，仍创建一个未 configure 的 decoder 占位，让 decode 阶段产生明确错误。
   */
  async init() {
    _stats.total++
    const baseConfig = { ...this.config }
    this._stack = new Error("Decoding error").stack

    // 创建 VideoDecoder 实例（独立于 configure 是否成功）
    this._decoder = new VideoDecoder({
      output: (frame) => {
        try {
          this.onSample(new VideoSample(frame))
        } catch (e) {
          // VideoSample 构造异常 → 关 frame 防泄漏，不抛错给 WebCodecs
          try {
            frame.close?.()
          } catch (_) {
            /* ignore */
          }
          if (_debug) console.warn("[HardwareDecoder] onSample error:", e)
        }
      },
      error: (error) => {
        if (this._stack) error.stack = this._stack
        // VideoDecoder 进入错误状态 —— 这是设备/驱动层级问题，无法在 customDecoder 内恢复。
        // 标记为 closed 让 mediabunny 后续 flush/close 调用不会再触发新的 configure。
        this._closed = true
        console.warn("[HardwareDecoder] VideoDecoder error event:", error)
      },
    })

    // 候选配置序列（按优先级）：硬件加速 → 无偏好
    const candidates = [
      {
        ...baseConfig,
        hardwareAcceleration: "prefer-hardware",
        optimizeForLatency: true,
        label: "prefer-hardware",
      },
      {
        ...baseConfig,
        hardwareAcceleration: "no-preference",
        optimizeForLatency: true,
        label: "no-preference",
      },
    ]

    let configured = false
    for (const cand of candidates) {
      const label = cand.label
      const cfg = { ...cand }
      delete cfg.label

      // 先用 isConfigSupported 探测
      let supported = false
      try {
        const r = await VideoDecoder.isConfigSupported(cfg)
        supported = r?.supported === true
      } catch (e) {
        supported = false
        log(`isConfigSupported(${label}) threw:`, e)
      }
      if (!supported) {
        log(`${label} not supported for codec ${cfg.codec}`)
        continue
      }

      // 真实 configure
      try {
        this._decoder.configure(cfg)
        this._activeMode = label
        configured = true
        if (label === "prefer-hardware") {
          _stats.hardware++
        } else {
          _stats.fallback++
        }
        log(`configured with ${label} for codec ${cfg.codec}`)
        break
      } catch (e) {
        log(`configure(${label}) failed:`, e)
        // 如果 configure 把 decoder 推到错误状态，再创建一个新的重试下一档
        try {
          this._decoder.close()
        } catch (_) {
          /* ignore */
        }
        this._decoder = new VideoDecoder({
          output: (frame) => {
            try {
              this.onSample(new VideoSample(frame))
            } catch (err) {
              try {
                frame.close?.()
              } catch (_) {
                /* ignore */
              }
              if (_debug) console.warn("[HardwareDecoder] onSample error:", err)
            }
          },
          error: (err) => {
            if (this._stack) err.stack = this._stack
            this._closed = true
            console.warn("[HardwareDecoder] VideoDecoder error event:", err)
          },
        })
      }
    }

    if (!configured) {
      _stats.failed++
      this._closed = true
      // 不抛错（见文件头注释）。decode 调用会被静默忽略，由上层超时/错误检测处理。
      console.warn(
        "[HardwareDecoder] 所有候选配置均不支持，customDecoder 进入 closed 状态。codec:",
        baseConfig.codec,
      )
    }
  }

  decode(packet) {
    if (!this._decoder || this._closed) return
    try {
      const chunk = packet.toEncodedVideoChunk()
      this._decoder.decode(chunk)
    } catch (e) {
      // decode 异常一般是输入数据有问题或 decoder 已 closed，记录但不抛错
      if (_debug) console.warn("[HardwareDecoder] decode error:", e)
    }
  }

  async flush() {
    if (!this._decoder || this._closed) return
    try {
      await this._decoder.flush()
    } catch (e) {
      if (_debug) console.warn("[HardwareDecoder] flush error:", e)
    }
  }

  close() {
    this._closed = true
    try {
      this._decoder?.close()
    } catch (_) {
      /* ignore */
    }
    this._decoder = null
  }
}

/**
 * 注册硬件加速解码器（幂等，多次调用只生效一次）。
 * 在播放器创建之前调用即可。
 */
export function registerHardwareDecoder() {
  if (_registered) return
  if (typeof VideoDecoder === "undefined") return
  try {
    registerDecoder(HardwareAcceleratedVideoDecoder)
    _registered = true
    log("registered")
  } catch (e) {
    console.warn("[HardwareDecoder] 注册失败:", e)
  }
}

/** 启用/关闭调试日志（运行时可调） */
export function setHardwareDecoderDebug(enabled) {
  _debug = !!enabled
  // 同步暴露到 window 方便控制台手工调
  if (typeof window !== "undefined") {
    window.__HARDWARE_DECODER_STATS__ = _stats
    window.__setHardwareDecoderDebug__ = setHardwareDecoderDebug
  }
}

/** 返回累计统计（控制台可直接用 window.__HARDWARE_DECODER_STATS__ 查看） */
export function getHardwareDecoderStats() {
  return { ..._stats }
}

// 模块加载即把统计对象挂到 window，方便用户随时查询
if (typeof window !== "undefined") {
  window.__HARDWARE_DECODER_STATS__ = _stats
  window.__setHardwareDecoderDebug__ = setHardwareDecoderDebug
}

export default HardwareAcceleratedVideoDecoder
