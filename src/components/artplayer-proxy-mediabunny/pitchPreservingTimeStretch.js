/**
 * Pitch-Preserving Time Stretching (WSOLA - Waveform Similarity Overlap-Add)
 * --------------------------------------------------------
 * 用于音频倍速播放时保持音调不变（避免变成"花栗鼠音"/尖锐音）。
 *
 * 关键改动（修复爆音）：
 *   v1（无状态函数）每次独立处理一个 mediabunny buffer，相邻 buffer 之间没有 crossfade，
 *   每秒约 10 次接缝就是 10 次"啪"声。
 *
 *   v2（有状态 stretcher 类）跨 buffer 维护：
 *     - pendingInput：累积尚未消费的输入样本
 *     - prevTailRef：上一次输出最后一帧的尾部 overlap（互相关参考）
 *     - prevTailSamples：上一次输出最后一帧的尾部样本（参与 fadeOut 叠加）
 *     - srcOffsetCarry：源指针在累积流上的位置（跨 buffer 不重置）
 *
 *   这样跨 buffer 的接缝同样走 crossfade + WSOLA 搜索，听感连续。
 *
 *   同时把 fadeIn/fadeOut 改为互补升余弦窗，严格满足 fadeIn[i] + fadeOut[i] = 1，
 *   消除 Hann(2N) 切两半时 i=N-1 处能量轻微缺口造成的微振铃。
 *
 * 性能：累积处理时单次新增样本仅在新增部分搜索，CPU 占用与原来相当。
 *
 * 使用：
 *   const stretcher = new TimeStretcher(audioCtx, sampleRate, channels)
 *   stretcher.setRate(1.5)
 *   const out = stretcher.process(inputBuffer)  // 返回 AudioBuffer 或 null（数据不足）
 *   stretcher.flush()                            // 倍速切换/seek/暂停时调用，重置内部状态
 */

// ============= 内部辅助 =============

/** 互补升余弦窗：fadeIn[i] + fadeOut[i] = 1，严格能量守恒 */
function buildComplementaryWindows(length) {
  const fadeIn = new Float32Array(length)
  const fadeOut = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    // 0.5 - 0.5*cos(π*i/(N-1))，i ∈ [0, N-1]
    const v = 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, length - 1))
    fadeIn[i] = v
    fadeOut[i] = 1 - v
  }
  return { fadeIn, fadeOut }
}

/**
 * 在 channel[searchStart : searchEnd] 中找到 d，使 channel[d:d+overlapLen]
 * 与 ref[0:overlapLen] 的归一化互相关最大。
 */
function findBestOffset(channel, ref, searchStart, searchEnd, overlapLen) {
  let bestOffset = searchStart
  let bestCorr = -Infinity

  const maxStart = Math.max(0, channel.length - overlapLen)
  const lo = Math.max(0, Math.min(maxStart, searchStart))
  const hi = Math.max(0, Math.min(maxStart, searchEnd))

  // 避免 ref 全 0 时除零导致结果不稳定
  let normRef = 0
  for (let i = 0; i < overlapLen; i++) normRef += ref[i] * ref[i]
  if (normRef < 1e-12) {
    // ref 几乎是静音，直接返回理想位置
    return Math.max(lo, Math.min(hi, searchStart + ((hi - lo) >> 1)))
  }

  for (let s = lo; s <= hi; s++) {
    let corr = 0
    let normSeg = 0
    for (let i = 0; i < overlapLen; i++) {
      const a = ref[i]
      const b = channel[s + i]
      corr += a * b
      normSeg += b * b
    }
    const denom = Math.sqrt(normRef * normSeg) + 1e-9
    const normCorr = corr / denom
    if (normCorr > bestCorr) {
      bestCorr = normCorr
      bestOffset = s
    }
  }
  return bestOffset
}

// ============= 公共类 =============

/**
 * 跨调用有状态的时间拉伸器。同一个播放会话内复用一个实例，
 * 在变速/seek/暂停切换时调用 flush() 重置。
 */
export class TimeStretcher {
  /**
   * @param {AudioContext} ctx
   * @param {number} sampleRate
   * @param {number} channels
   * @param {Object} [opts]
   * @param {number} [opts.frameSizeSec=0.022] - 单帧时长（秒）。22ms 对人声较友好，对应 ~45Hz 周期。
   * @param {number} [opts.overlapRatio=0.5]
   * @param {number} [opts.searchSec=0.020]   - 互相关搜索半径。20ms 覆盖 ≥50Hz 一个完整周期。
   */
  constructor(ctx, sampleRate, channels, opts = {}) {
    this.ctx = ctx
    this.sampleRate = sampleRate
    this.channels = Math.max(1, channels | 0)

    // 默认参数参考 SoundTouch / RubberBand 等专业实现：
    //   - frameSizeSec 22ms：足够覆盖人声基频一个完整周期，且响应足够快
    //   - overlap 50%：crossfade 平滑
    //   - searchSec 20ms：足够找到与参考信号最相似的位置（WSOLA 核心）
    const frameSizeSec = opts.frameSizeSec ?? 0.022
    const overlapRatio = opts.overlapRatio ?? 0.5
    const searchSec = opts.searchSec ?? 0.02

    this.frameSize = Math.max(64, Math.round(frameSizeSec * sampleRate))
    this.overlap = Math.max(16, Math.round(this.frameSize * overlapRatio))
    this.hop = this.frameSize - this.overlap
    this.searchWin = Math.max(8, Math.round(searchSec * sampleRate))

    const win = buildComplementaryWindows(this.overlap)
    this.fadeIn = win.fadeIn
    this.fadeOut = win.fadeOut

    this.rate = 1

    // pending 输入累积（每个声道一个 Float32Array），按 sampleRate 计的样本
    this.pending = []
    for (let c = 0; c < this.channels; c++) {
      this.pending.push(new Float32Array(0))
    }
    // 单声道下混（左右声道平均），用于互相关搜索 —— 这样多声道相位才不会失配
    this.pendingMono = new Float32Array(0)

    // 上一帧实际选中的源起始位置（关键：WSOLA 的下一帧搜索从 prevBestOffset + hop*rate 出发）
    this.prevBestOffset = 0
    // 上一帧消费源样本到的位置（用于丢弃 pending 头部）
    this.consumedTo = 0

    // 上一次输出的最后一帧尾部 overlap 样本：用于 crossfade 的 fadeOut 端
    this.prevTailSamples = []
    for (let c = 0; c < this.channels; c++) {
      this.prevTailSamples.push(new Float32Array(this.overlap))
    }
    // 互相关参考：上一帧在源中的"自然延续"区段（mono），即 source[prevBestOffset+hop, prevBestOffset+hop+overlap)
    // 这是标准 WSOLA 的 ref 定义 —— 寻找与"如果不变速会自然出现的信号"最相似的位置
    this.prevTailRef = new Float32Array(this.overlap)

    // 是否已经输出过第一帧
    this.primed = false
  }

  /** 设置新的速率。可在播放中动态调用，但建议配合 flush 使用以避免相位混乱。 */
  setRate(rate) {
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 1
  }

  /** 重置内部状态：保留参数，丢弃所有累积样本与上一帧记忆 */
  flush() {
    for (let c = 0; c < this.channels; c++) {
      this.pending[c] = new Float32Array(0)
      this.prevTailSamples[c].fill(0)
    }
    this.pendingMono = new Float32Array(0)
    this.prevTailRef.fill(0)
    this.prevBestOffset = 0
    this.consumedTo = 0
    this.primed = false
  }

  /** 把新输入累积进 pending（同时构建/扩展单声道下混） */
  _appendPending(input) {
    const ch = Math.min(input.numberOfChannels, this.channels)
    const inLen = input.length

    // 1) 多声道累积
    const newPerChannel = []
    for (let c = 0; c < this.channels; c++) {
      const oldArr = this.pending[c]
      const newArr = new Float32Array(oldArr.length + inLen)
      newArr.set(oldArr, 0)
      // 多声道场景：声道数不足时复用最后一个声道
      const srcCh = c < ch ? c : ch - 1
      newArr.set(input.getChannelData(srcCh), oldArr.length)
      this.pending[c] = newArr
      newPerChannel.push(newArr)
    }

    // 2) 单声道下混（用于互相关搜索 —— 比单用首声道对立体声材料表现更好）
    const oldMono = this.pendingMono
    const newMono = new Float32Array(oldMono.length + inLen)
    newMono.set(oldMono, 0)
    const monoStart = oldMono.length
    if (this.channels === 1) {
      newMono.set(newPerChannel[0].subarray(monoStart), monoStart)
    } else {
      // 多声道平均下混
      const inv = 1 / this.channels
      for (let i = 0; i < inLen; i++) {
        let s = 0
        for (let c = 0; c < this.channels; c++) {
          s += newPerChannel[c][monoStart + i]
        }
        newMono[monoStart + i] = s * inv
      }
    }
    this.pendingMono = newMono
  }

  /** 从 pending 头部丢弃 n 个样本（每个声道 + mono） */
  _dropPending(n) {
    if (n <= 0) return
    for (let c = 0; c < this.channels; c++) {
      this.pending[c] = this.pending[c].subarray(n)
    }
    this.pendingMono = this.pendingMono.subarray(n)
  }

  /**
   * 处理新输入 buffer，返回拉伸后的 AudioBuffer，或 null（累积数据不足以输出任何完整帧）。
   * rate === 1 时直接返回原 buffer 的拷贝（保持外部调用一致），零计算开销。
   */
  process(input) {
    if (!input) return null
    if (this.rate === 1) {
      // 1x 路径：完全 bypass，外部直接用原 buffer 即可。这里返回 input 让上层判断。
      return input
    }

    this._appendPending(input)

    const channels = this.channels
    const overlap = this.overlap
    const hop = this.hop
    const frameSize = this.frameSize
    const searchWin = this.searchWin
    const rate = this.rate

    // 互相关搜索时需要 [bestOffset, bestOffset+frameSize)，bestOffset 最大 = idealSrc + searchWin
    // 帧后还需要再算一次 "自然延续" 段 [bestOffset+hop, bestOffset+hop+overlap)
    // 故每次搜索需要的最大读取位置 = idealSrc + searchWin + hop + overlap
    const totalAvail = this.pendingMono.length

    // 至少能完成首帧（frameSize + 一个 search 准备）
    const minNeed = frameSize + searchWin + hop + overlap
    if (totalAvail < minNeed) return null

    // 用 ArrayList 风格累积输出（每帧 hop 样本，首帧 frameSize 样本），最后一次性创建 AudioBuffer
    // 容量预估：根据可用数据 + rate 算输出帧数上限
    const usable = totalAvail - searchWin - hop - overlap
    let estFrames
    if (!this.primed) {
      estFrames =
        1 + Math.max(0, Math.floor((usable - frameSize) / (hop * rate)))
    } else {
      // primed 时 prevBestOffset 是上次结束位置（相对 pendingMono 起点）
      const startSrc = this.prevBestOffset + hop * rate
      estFrames = Math.max(
        0,
        Math.floor((usable - startSrc) / (hop * rate)) + 1,
      )
    }
    if (estFrames <= 0) return null

    const estOutLen = (this.primed ? 0 : hop) + estFrames * hop
    if (estOutLen <= 0) return null

    // 临时多声道输出缓冲（Float32Array 每声道）
    const outBuf = []
    for (let c = 0; c < channels; c++) outBuf.push(new Float32Array(estOutLen))

    const driverMono = this.pendingMono
    let outPos = 0
    let lastBestOffset = this.prevBestOffset

    // ---- 1. 首帧（仅当未 primed） ----
    if (!this.primed) {
      // 直接拷贝首帧 [0, frameSize) 到输出 [0, frameSize)
      // outPos 推进 hop（剩下的 overlap 位置会在下一帧 crossfade 中被覆盖）
      for (let c = 0; c < channels; c++) {
        const ip = this.pending[c]
        const op = outBuf[c]
        for (let i = 0; i < frameSize; i++) op[i] = ip[i]
      }
      // ref = source 自然延续区段 [hop, hop+overlap)（首帧的 "如果不变速会出现" 的下一段）
      for (let i = 0; i < overlap; i++) {
        this.prevTailRef[i] = driverMono[hop + i]
      }
      // prevTailSamples = 首帧尾部 [frameSize-overlap, frameSize) 的多声道样本
      // 注意：首帧 outPos 只推进了 hop，因此 outBuf[outPos:outPos+overlap] 实际是源 [hop, frameSize) 的内容
      // 这就是下一帧 crossfade 时的 fadeOut 端（已经写入了 outBuf 但尚未被 hop 覆盖）
      for (let c = 0; c < channels; c++) {
        const ip = this.pending[c]
        for (let i = 0; i < overlap; i++) {
          this.prevTailSamples[c][i] = ip[hop + i]
        }
      }
      lastBestOffset = 0
      outPos = hop
      this.primed = true
    }

    // ---- 2. 后续帧（标准 WSOLA：从 prevBestOffset + hop*rate 出发搜索） ----
    while (true) {
      const idealSrc = Math.round(lastBestOffset + hop * rate)
      const sStart = idealSrc - searchWin
      const sEnd = idealSrc + searchWin

      // 越界检查：bestOffset+frameSize 不能超出 pendingMono；自然延续段也要在范围内
      const maxAllowed = driverMono.length - frameSize
      if (sStart > maxAllowed) break // 没数据可搜了

      // 互相关搜索（与 prevTailRef 比对）
      const bestOffset = findBestOffset(
        driverMono,
        this.prevTailRef,
        sStart,
        Math.min(sEnd, maxAllowed),
        overlap,
      )
      // 自然延续段也需在范围内
      if (bestOffset + hop + overlap > driverMono.length) break
      if (outPos + hop > estOutLen) break

      // crossfade: 输出 [outPos : outPos+overlap] = prevTailSamples * fadeOut + ip[bestOffset:] * fadeIn
      const tailLen = frameSize - overlap
      for (let c = 0; c < channels; c++) {
        const ip = this.pending[c]
        const op = outBuf[c]
        const tail = this.prevTailSamples[c]
        // crossfade 区段
        for (let i = 0; i < overlap; i++) {
          op[outPos + i] =
            tail[i] * this.fadeOut[i] + ip[bestOffset + i] * this.fadeIn[i]
        }
        // 当前帧剩余 [overlap, frameSize) 直接拷贝（注意：只写到 outPos+hop 之内，剩下部分会被下一帧 crossfade 覆盖）
        const dstBase = outPos + overlap
        const srcBase = bestOffset + overlap
        // 但 outBuf 长度是 hop 块连续，写到 dstBase + tailLen = outPos + frameSize 可能越界
        const tailWrite = Math.min(tailLen, estOutLen - dstBase)
        for (let i = 0; i < tailWrite; i++) {
          op[dstBase + i] = ip[srcBase + i]
        }
      }

      // 准备下一帧的 ref 和 prevTailSamples：
      //   ref = 自然延续段 = source[bestOffset + hop, bestOffset + hop + overlap)（来自单声道 driver）
      //   prevTailSamples = 当前帧已写入 outBuf 但尚未被 hop 推进覆盖的尾部 overlap 个样本
      //                   = outBuf[outPos+hop : outPos+hop+overlap]
      //                   也就是源 [bestOffset+hop, bestOffset+hop+overlap)
      for (let i = 0; i < overlap; i++) {
        this.prevTailRef[i] = driverMono[bestOffset + hop + i]
      }
      for (let c = 0; c < channels; c++) {
        const ip = this.pending[c]
        for (let i = 0; i < overlap; i++) {
          this.prevTailSamples[c][i] = ip[bestOffset + hop + i]
        }
      }

      lastBestOffset = bestOffset
      outPos += hop
    }

    // ---- 3. 丢弃已消费的 pending 头部样本 ----
    // 保留余量：下次最早会读到的位置 = lastBestOffset + hop*rate - searchWin（搜索下界）
    // 再保留一个 frameSize + overlap 余量给越界检查
    const nextSearchStart = Math.floor(lastBestOffset + hop * rate) - searchWin
    const safetyMargin = frameSize + overlap
    const dropTo = Math.max(0, nextSearchStart - safetyMargin)
    if (dropTo > 0) {
      this._dropPending(dropTo)
      lastBestOffset -= dropTo
    }
    this.prevBestOffset = lastBestOffset

    // ---- 4. 把临时 Float32Array 输出转 AudioBuffer ----
    if (outPos <= 0) return null
    const finalBuf = this.ctx.createBuffer(channels, outPos, this.sampleRate)
    for (let c = 0; c < channels; c++) {
      finalBuf.getChannelData(c).set(outBuf[c].subarray(0, outPos))
    }
    return finalBuf
  }
}

// ============= 兼容旧接口（保留无状态 timeStretch，但内部走 stretcher 一次性流程） =============

/**
 * @deprecated 请使用 TimeStretcher 类以避免相邻 buffer 之间的爆音。
 * 这里保留是为了向后兼容；如果调用方没维护状态，每个 buffer 接缝仍会有轻微爆音。
 */
export function timeStretch(ctx, input, rate) {
  if (!input || rate === 1 || !Number.isFinite(rate) || rate <= 0) return input
  const s = new TimeStretcher(ctx, input.sampleRate, input.numberOfChannels)
  s.setRate(rate)
  const out = s.process(input)
  return out ?? input
}
