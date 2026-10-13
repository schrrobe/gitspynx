import { expect, it } from 'vitest'
import { isSecretPrompt } from './prompt'

it('masks password and passphrase prompts, not usernames or host key questions', () => {
  expect(isSecretPrompt("Password for 'https://ada@github.com': ")).toBe(true)
  expect(isSecretPrompt("Enter passphrase for key '/Users/ada/.ssh/id_ed25519': ")).toBe(true)
  expect(isSecretPrompt("Username for 'https://github.com': ")).toBe(false)
  expect(isSecretPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toBe(false)
})
