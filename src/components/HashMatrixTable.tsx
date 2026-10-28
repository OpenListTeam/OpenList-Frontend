import { Badge, Box, Checkbox, HStack, Text } from "@hope-ui/solid"
import { For, Show } from "solid-js"
import { useT } from "~/hooks"
import type { SeedHashAlgorithm, SeedHashMatrix } from "~/types"

export const HASH_ALGORITHMS: SeedHashAlgorithm[] = ["md5", "sha1", "sha256"]

export interface HashMatrixNote {
  text: string
  tone: "success" | "warning"
}

export interface HashMatrixTableProps {
  matrix: SeedHashMatrix
  onChange: (
    algorithm: SeedHashAlgorithm,
    scope: "whole" | "pieces",
    checked: boolean,
  ) => void
  /** 该算法由所选格式强制要求：显示 required 标记并禁止取消勾选 */
  isForced?: (algorithm: SeedHashAlgorithm) => boolean
  /** 额外的禁用条件（例如种子已有哈希时只能复用） */
  isWholeDisabled?: (algorithm: SeedHashAlgorithm) => boolean
  isPiecesDisabled?: (algorithm: SeedHashAlgorithm) => boolean
  /** 行尾状态说明，例如「已在种子中 / 需从文件计算」 */
  noteFor?: (algorithm: SeedHashAlgorithm) => HashMatrixNote | null
}

/**
 * 哈希矩阵表格。生成种子与格式转换共用同一份实现，保证两处样式一致：
 * 算法 / 整文件 / 分片，强制项行内标记。
 */
export const HashMatrixTable = (props: HashMatrixTableProps) => {
  const t = useT()
  const noteWidth = () => (props.noteFor ? "$32" : undefined)
  return (
    <Box border="1px solid $neutral6" borderRadius="$md" overflow="hidden">
      <HStack px="$3" py="$2" spacing="$2" bgColor="$neutral3">
        <Text flex="1" fontSize="$xs" color="$neutral11">
          {t("home.transfer_seed.hash_algorithm")}
        </Text>
        <Text w="$24" fontSize="$xs" color="$neutral11">
          {t("home.transfer_seed.whole")}
        </Text>
        <Text w="$24" fontSize="$xs" color="$neutral11">
          {t("home.transfer_seed.pieces")}
        </Text>
        <Show when={props.noteFor}>
          <Text w={noteWidth()} fontSize="$xs" color="$neutral11">
            {t("home.transfer_seed.hash_state")}
          </Text>
        </Show>
      </HStack>
      <For each={HASH_ALGORITHMS}>
        {(algorithm, index) => {
          const forced = () => props.isForced?.(algorithm) === true
          const note = () => props.noteFor?.(algorithm) || null
          return (
            <HStack
              px="$3"
              py="$2"
              spacing="$2"
              alignItems="center"
              borderTop={index() === 0 ? undefined : "1px solid $neutral5"}
              bgColor={forced() ? "$neutral2" : undefined}
            >
              <HStack flex="1" spacing="$2" alignItems="center">
                <Text fontSize="$sm" fontWeight="$medium">
                  {algorithm.toUpperCase()}
                </Text>
                <Show when={forced()}>
                  <Badge colorScheme="info">
                    {t("home.transfer_seed.required_short")}
                  </Badge>
                </Show>
              </HStack>
              <Checkbox
                w="$24"
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
              <Checkbox
                w="$24"
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
              <Show when={props.noteFor}>
                <Text
                  w={noteWidth()}
                  fontSize="$xs"
                  color={
                    note()?.tone === "warning" ? "$warning11" : "$success11"
                  }
                >
                  {note()?.text || ""}
                </Text>
              </Show>
            </HStack>
          )
        }}
      </For>
    </Box>
  )
}
