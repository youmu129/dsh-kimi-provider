// 本地类型 shim：镜像 @deepseek-ai/dsh-client-ui-primitives 公开类型子集
// （仅声明本插件 client 半面用到的符号：IconClockOutlineRegular / Tooltip /
// useAnchoredPosition / useDismissOnOutsidePointer）。
// 运行时实现由 Web shell 基线模块表供给（shell 直接以模块 id 注册该包，
// 插件 lazy-CJS factory 的 require 同样命中；构建端在 tsdown CLIENT_BASELINE
// external，不打进 bundle）。该包不作为 npm 依赖安装，类型仅本地校验用——
// 若后续升级 DSH 且签名变化，以 DSH 检出内 packages/client/ui-primitives
// 的导出为准同步本文件。

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { CSSProperties, ReactElement, RefObject, SVGProps } from 'react'

  export interface AnchoredPositionOptions {
    /** Whether the floating element is mounted and should track its anchor. */
    open: boolean
    /** The element the panel is placed from. */
    anchorRef: RefObject<HTMLElement | null>
    /** The floating element, measured so the clamp uses real dimensions. */
    panelRef: RefObject<HTMLElement | null>
    /** Which anchor edge the panel hangs from: below it (`bottom`, the default) or above it (`top`). */
    side?: 'top' | 'bottom'
    /** Which anchor edge the panel lines up with: its left edge (`start`, the default) or its right edge (`end`). */
    align?: 'start' | 'end'
    /** Distance kept between the anchor edge named by `side` and the panel. */
    gap: number
    /** Distance kept between the panel and each viewport edge. */
    margin: number
  }

  /** Track an anchor and return the panel's fixed coordinates (null before the first measurement). */
  export function useAnchoredPosition(options: AnchoredPositionOptions): CSSProperties | null

  /** Close an open popover when a pointerdown lands outside its root element. */
  export function useDismissOnOutsidePointer(
    root: RefObject<HTMLElement | null>,
    open: boolean,
    setOpen: (open: boolean) => void,
    portal?: RefObject<HTMLElement | null>,
  ): void

  /** Attach a hover/focus tooltip to an anchor element (single child). */
  export function Tooltip(props: {
    label: string | (() => string)
    shortcutKeys?: readonly string[]
    side?: 'right' | 'bottom' | 'top'
    align?: 'center' | 'end'
    delayMs?: number
    gap?: number
    disabled?: boolean
    portal?: boolean
    maxWidth?: number
    children: ReactElement
  }): ReactElement

  /** Outline clock icon（16×16 viewBox、1px 描边、currentColor）。 */
  export const IconClockOutlineRegular: (props: SVGProps<SVGSVGElement>) => ReactElement
}
