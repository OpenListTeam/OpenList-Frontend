import { Center, ElementType, Spinner, SpinnerProps } from "@hope-ui/solid"
import { JSXElement, mergeProps, Show } from "solid-js"
import { getMainColor } from "~/store"

export const FullScreenLoading = () => {
  return null
}

export const FullLoading = (_props: {
  py?: string
  size?: string
  thickness?: number
  ref?: any
}) => {
  return null
}

export const MaybeLoading = (props: {
  children?: JSXElement
  loading?: boolean
}) => {
  return <>{props.children}</>
}

export const CenterLoading = <C extends ElementType = "div">(
  _props: SpinnerProps<C>,
) => {
  return null
}
// 把 FullLoading.tsx 里的四个组件改成不同文字：
