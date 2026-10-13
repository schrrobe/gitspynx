import { shallowRef } from 'vue'

interface PromptRequest {
  title: string
  value: string
  okLabel: string
  secret: boolean // masked input, taken as typed (no trimming)
  resolve: (value: string | null) => void
}

export const promptRequest = shallowRef<PromptRequest | null>(null)

// Text input dialog (Electron has no window.prompt); resolves null on cancel or empty input.
export function ask(title: string, value = '', okLabel = 'OK', secret = false): Promise<string | null> {
  promptRequest.value?.resolve(null)
  return new Promise((resolve) => {
    promptRequest.value = { title, value, okLabel, secret, resolve }
  })
}

// git/ssh credential prompts ("Password for …", "Enter passphrase for key …", host key questions)
export const isSecretPrompt = (prompt: string) => /password|passphrase|passcode|token|\bpin\b/i.test(prompt)
