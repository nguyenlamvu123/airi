import { useLocalStorage } from '@vueuse/core'
import { ref } from 'vue'

export const supportedControl = ['x', 'y', 'scale'] as const
type SupportedControl = typeof supportedControl[number]
interface ControlConfig { min: number, max: number, step: number, default: number, buttonText: string }

/** show or hide the control element(slider) on stage */
const viewControlsEnabled = ref(false)
/** what value to control for the control element */
const viewControlMode = ref<SupportedControl>('scale')
/** image position relative to the center of the screen, in percentages */
const position = useLocalStorage<{ x: number, y: number }>('settings/image/position', { x: 0, y: 0 })
/** image scaling factor. `1` means no scaling. */
const scale = useLocalStorage('settings/image/scale', 1)

const formatPercentD1 = (val: number) => `${val.toFixed(1)}%`
const formatToPercent = (val: number) => `${(val * 100).toFixed(0)}%`

/**
 * Per-surface slider ranges for the static image character view control,
 * following the same shape as the live2d/three view controls.
 */
export const defaultImageControlConfig: Record<SupportedControl, ControlConfig> = {
  x: {
    min: -500,
    max: 500,
    step: 0.1,
    default: 0,
    buttonText: 'X',
  },
  y: {
    min: -500,
    max: 500,
    step: 0.1,
    default: 0,
    buttonText: 'Y',
  },
  scale: {
    min: 0.01,
    max: 3,
    step: 0.01,
    default: 1,
    buttonText: 'Scale',
  },
}

/** Formats image view control values for the slider tooltip. */
export const formatter: Record<SupportedControl, (val: number) => string> = {
  x: formatPercentD1,
  y: formatPercentD1,
  scale: formatToPercent,
}
const clampMinMax = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Shared view control for the static image character renderer: x/y position
 * (percentage of the stage size, matching the live2d semantics) and a scale
 * factor. State is module-scoped and persisted under its own storage keys so
 * the image character keeps an independent transform from Live2D models.
 */
export function useImageViewControl() {
  function set(key: SupportedControl, value?: number) {
    const clamped = value !== undefined ? clampMinMax(value, defaultImageControlConfig[key].min, defaultImageControlConfig[key].max) : undefined
    switch (key) {
      case 'x':
        position.value.x = clamped ?? defaultImageControlConfig.x.default
        break
      case 'y':
        position.value.y = clamped ?? defaultImageControlConfig.y.default
        break
      case 'scale':
        scale.value = clamped ?? defaultImageControlConfig.scale.default
        break
    }
  }

  return {
    position,
    scale,
    set,
    viewControlsEnabled,
    viewControlMode,
  }
}
