import test from "node:test"
import assert from "node:assert/strict"
import { TimeStretcher, timeStretch } from "./pitchPreservingTimeStretch.js"

const SAMPLE_RATE = 48000

/** 最小 AudioContext 替身：WSOLA 只需要 createBuffer */
const createCtx = () => ({
  createBuffer(channels, length, sampleRate) {
    const data = Array.from(
      { length: channels },
      () => new Float32Array(length),
    )
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: (c) => data[c],
    }
  },
})

/** 最小 AudioBuffer 替身 */
const createInput = (samples, channels = 1) => {
  const data = Array.from({ length: channels }, () =>
    Float32Array.from(samples),
  )
  return {
    numberOfChannels: channels,
    length: samples.length,
    sampleRate: SAMPLE_RATE,
    getChannelData: (c) => data[Math.min(c, channels - 1)],
  }
}

const sine = (length, freq = 440) => {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
  }
  return out
}

const allFinite = (buffer) => {
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) return false
    }
  }
  return true
}

test("rate = 1 时直接透传原 buffer", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 1)
  const input = createInput(sine(4096))
  assert.equal(stretcher.process(input), input)
})

test("非法 rate 回退为 1（透传）", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 1)
  const input = createInput(sine(4096))
  stretcher.setRate(0)
  assert.equal(stretcher.process(input), input)
  stretcher.setRate(Number.NaN)
  assert.equal(stretcher.process(input), input)
  stretcher.setRate(-2)
  assert.equal(stretcher.process(input), input)
})

test("1.5x 输出比输入短且样本均为有限值", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 1)
  stretcher.setRate(1.5)
  const input = createInput(sine(SAMPLE_RATE))
  const out = stretcher.process(input)
  assert.ok(out, "应输出 buffer")
  assert.ok(out.length > 0, "输出不为空")
  assert.ok(out.length < SAMPLE_RATE, "1.5 倍速后样本数应减少")
  assert.ok(out.length > SAMPLE_RATE / 3, "不应过度截断")
  assert.ok(allFinite(out), "输出不应出现 NaN / Infinity")
})

test("0.75x 输出比输入长", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 1)
  stretcher.setRate(0.75)
  const input = createInput(sine(SAMPLE_RATE))
  const out = stretcher.process(input)
  assert.ok(out)
  assert.ok(out.length > SAMPLE_RATE, "0.75 倍速后样本数应增加")
  assert.ok(allFinite(out))
})

test("连续两个 buffer 都能产出数据（跨 buffer 有状态）", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 1)
  stretcher.setRate(1.25)
  const first = stretcher.process(createInput(sine(SAMPLE_RATE)))
  const second = stretcher.process(createInput(sine(SAMPLE_RATE)))
  assert.ok(first)
  assert.ok(second)
  assert.ok(allFinite(first) && allFinite(second))
})

test("数据不足时返回 null", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 1)
  stretcher.setRate(1.5)
  assert.equal(stretcher.process(createInput(sine(512))), null)
})

test("flush 后内部状态复位", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 1)
  stretcher.setRate(1.5)
  assert.ok(stretcher.process(createInput(sine(SAMPLE_RATE))))
  stretcher.flush()
  // flush 后 pending 被清空，少量数据不足以产出任何帧
  assert.equal(stretcher.process(createInput(sine(1024))), null)
})

test("立体声输入输出保持声道数", () => {
  const stretcher = new TimeStretcher(createCtx(), SAMPLE_RATE, 2)
  stretcher.setRate(1.5)
  const input = createInput(sine(SAMPLE_RATE), 2)
  const out = stretcher.process(input)
  assert.ok(out)
  assert.equal(out.numberOfChannels, 2)
  assert.ok(allFinite(out))
})

test("timeStretch 兼容接口：1x 透传，非 1x 返回新 buffer", () => {
  const ctx = createCtx()
  const input = createInput(sine(SAMPLE_RATE))
  assert.equal(timeStretch(ctx, input, 1), input)
  const stretched = timeStretch(ctx, input, 1.25)
  assert.ok(stretched)
  assert.notEqual(stretched, input)
  assert.ok(stretched.length > 0)
  assert.ok(allFinite(stretched))
})
