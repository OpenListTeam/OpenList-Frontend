import { Box } from "@hope-ui/solid"
import { SelectWrapper } from "./Base"
import chardet from "chardet"
import { createEffect } from "solid-js"

const MIN_CONFIDENCE = 30

const encodingLabels = [
  "utf-8",
  "gbk",
  "gb18030",
  "ibm866",
  "iso-8859-2",
  "iso-8859-3",
  "iso-8859-4",
  "iso-8859-5",
  "iso-8859-6",
  "iso-8859-7",
  "iso-8859-8",
  "iso-8859-8i",
  "iso-8859-10",
  "iso-8859-13",
  "iso-8859-14",
  "iso-8859-15",
  "iso-8859-16",
  "koi8-r",
  "koi8-u",
  "macintosh",
  "windows-874",
  "windows-1250",
  "windows-1251",
  "windows-1252",
  "windows-1253",
  "windows-1254",
  "windows-1255",
  "windows-1256",
  "windows-1257",
  "windows-1258",
  "x-mac-cyrillic",
  "big5",
  "euc-jp",
  "iso-2022-jp",
  "shift_jis",
  "euc-kr",
  "iso-2022-kr",
  "utf-16be",
  "utf-16le",
  "x-user-defined",
  "iso-2022-cn",
]

const encodingLabelSet = new Set(encodingLabels)

/**
 * Detect encoding from BOM (Byte Order Mark).
 * Returns the detected encoding or undefined if no BOM found.
 */
function detectBOM(buffer: Uint8Array): string | undefined {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return "utf-8"
  }
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return "utf-16le"
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return "utf-16be"
  }
  return undefined
}

/**
 * Detect encoding using chardet with confidence filtering.
 * Returns the best match or undefined if no confident match found.
 */
function detectByChardet(buffer: Uint8Array): string | undefined {
  const results = chardet.analyse(buffer)
  for (const result of results) {
    if (result.confidence >= MIN_CONFIDENCE) {
      const label = result.name.toLowerCase()
      if (encodingLabelSet.has(label)) {
        return label
      }
    }
  }
  return undefined
}

export function EncodingSelect(props: {
  encoding: string
  setEncoding: (encoding: string) => void
  referenceText?: string | ArrayBuffer
}) {
  createEffect(() => {
    const data = props.referenceText
    // Skip detection for strings - they are already decoded (TextEncoder always produces UTF-8)
    if (!data || typeof data === "string") return

    const buffer = new Uint8Array(data)

    // 1. Try BOM detection first (fast and accurate)
    const bomEncoding = detectBOM(buffer)
    if (bomEncoding) {
      props.setEncoding(bomEncoding)
      return
    }

    // 2. Fall back to chardet with confidence filtering
    const detected = detectByChardet(buffer)
    if (detected) {
      props.setEncoding(detected)
    }
  })

  return (
    <Box
      pos="absolute"
      right={0}
      top={0}
      w="$36"
      opacity={0.15}
      _hover={{
        opacity: 1,
      }}
      zIndex="$docked"
    >
      <SelectWrapper
        options={encodingLabels.map((label) => ({
          label: label.toLocaleUpperCase(),
          value: label,
        }))}
        value={props.encoding}
        onChange={(v) => props.setEncoding(v)}
      />
    </Box>
  )
}
