import { Badge, Box, Checkbox, HStack, Text, VStack } from "@hope-ui/solid"
import { For, Show } from "solid-js"
import { useT } from "~/hooks"
import type { SeedHashAlgorithm, SeedHashMatrix } from "~/types"

export const HASH_ALGORITHMS: SeedHashAlgorithm[] = ["md5", "sha1", "sha256"]

export interface HashMatrixNote {
  text: string
  tone: "success" | "warning"
}

export type HashScope = "whole" | "pieces"

export interface HashMatrixTableProps {
  matrix: SeedHashMatrix
  onChange: (
    algorithm: SeedHashAlgorithm,
    scope: HashScope,
    checked: boolean,
  ) => void
  /** 该算法由所选格式强制要求：禁止取消勾选 */
  isForced?: (algorithm: SeedHashAlgorithm) => boolean
  /** 强制该算法的格式名称，用于在行内注明「是什么种子需要它」 */
  requiredBy?: (algorithm: SeedHashAlgorithm) => string[]
  /** 额外的禁用条件（例如种子已有哈希时只能复用） */
  isWholeDisabled?: (algorithm: SeedHashAlgorithm) => boolean
  isPiecesDisabled?: (algorithm: SeedHashAlgorithm) => boolean
  /** 每个格子单独的状态：整文件 / 分片各自是否已在种子中 */
  statusFor?: (
    algorithm: SeedHashAlgorithm,
    scope: HashScope,
  ) => HashMatrixNote | null
}

const CellStatus = (props: { note: HashMatrixNote | null }) => (
  <Show when={props.note}>
    <Text
      fontSize="10px"
      lineHeight="1.2"
      color={props.note?.tone === "warning" ? "$warning11" : "$success11"}
    >
      {props.note?.text}
    </Text>
  </Show>
)

/**
 * 哈希矩阵表格。生成种子与格式转换共用同一份实现：
 * 算法 / 整文件 / 分片，强制项标注需要的格式，状态按格子分别显示。
 */
export const HashMatrixTable = (props: HashMatrixTableProps) => {
  const t = useT()
  const hasStatus = () => !!props.statusFor
  const colWidth = () => (hasStatus() ? "$32" : "$24")
  return (
    <Box border="1px solid $neutral6" borderRadius="$md" overflow="hidden">
      <HStack px="$3" py="$2" spacing="$2" bgColor="$neutral3">
        <Text flex="1" fontSize="$xs" color="$neutral11">
          {t("home.transfer_seed.hash_algorithm")}
        </Text>
        <Text w={colWidth()} fontSize="$xs" color="$neutral11">
          {t("home.transfer_seed.whole")}
        </Text>
        <Text w={colWidth()} fontSize="$xs" color="$neutral11">
          {t("home.transfer_seed.pieces")}
        </Text>
      </HStack>
      <For each={HASH_ALGORITHMS}>
        {(algorithm, index) => {
          const forced = () => props.isForced?.(algorithm) === true
          const requiredFormats = () => props.requiredBy?.(algorithm) || []
          return (
            <HStack
              px="$3"
              py="$2"
              spacing="$2"
              alignItems="center"
              borderTop={index() === 0 ? undefined : "1px solid $neutral5"}
              bgColor={forced() ? "$neutral2" : undefined}
            >
              <HStack flex="1" spacing="$2" alignItems="center" flexWrap="wrap">
                <Text fontSize="$sm" fontWeight="$medium">
                  {algorithm.toUpperCase()}
                </Text>
                <Show when={requiredFormats().length > 0}>
                  <Badge colorScheme="info">
                    {requiredFormats().join(", ")}
                  </Badge>
                </Show>
              </HStack>

              <VStack w={colWidth()} spacing="2px" alignItems="flex-start">
                <Checkbox
                  size="sm"
                  checked={props.matrix[algorithm].whole}
                  disabled={forced() || props.isWholeDisabled?.(algorithm)}
                  onChange={(event: { currentTarget: HTMLInputElement }) =>
                    props.onChange(
                      algorithm,
                      "whole",
                      event.currentTarget.checked,
                    )
                  }
                >
                  {t("home.transfer_seed.whole")}
                </Checkbox>
                <CellStatus
                  note={props.statusFor?.(algorithm, "whole") || null}
                />
              </VStack>

              <VStack w={colWidth()} spacing="2px" alignItems="flex-start">
                <Checkbox
                  size="sm"
                  checked={props.matrix[algorithm].pieces}
                  disabled={forced() || props.isPiecesDisabled?.(algorithm)}
                  onChange={(event: { currentTarget: HTMLInputElement }) =>
                    props.onChange(
                      algorithm,
                      "pieces",
                      event.currentTarget.checked,
                    )
                  }
                >
                  {t("home.transfer_seed.pieces")}
                </Checkbox>
                <CellStatus
                  note={props.statusFor?.(algorithm, "pieces") || null}
                />
              </VStack>
            </HStack>
          )
        }}
      </For>
    </Box>
  )
}
