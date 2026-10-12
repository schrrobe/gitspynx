import { shallowRef } from 'vue'

interface PromptRequest {
  title: string
  value: string
  okLabel: string
  resolve: (value: string | null) => void
}

export const promptRequest = shallowRef<PromptRequest | null>(null)

// Text input dialog (Electron has no window.prompt); resolves null on cancel or empty input.
export function ask(title: string, value = '', okLabel = 'OK'): Promise<string | null> {
  promptRequest.value?.resolve(null)
  return new Promise((resolve) => {
    promptRequest.value = { title, value, okLabel, resolve }
  })
}
