<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { promptRequest } from '../prompt'

const dialog = ref<HTMLDialogElement>()
const input = ref<HTMLInputElement>()
const value = ref('')

watch(promptRequest, async (req) => {
  if (!req) return dialog.value?.close()
  value.value = req.value
  dialog.value?.showModal()
  await nextTick()
  input.value?.select()
})

function finish(result: string | null) {
  const req = promptRequest.value
  promptRequest.value = null
  req?.resolve((req.secret ? result : result?.trim()) || null)
}
</script>

<template>
  <dialog ref="dialog" @cancel.prevent="finish(null)">
    <form method="dialog" @submit.prevent="finish(value)">
      <label for="prompt-input">{{ promptRequest?.title }}</label>
      <input id="prompt-input" ref="input" v-model="value" :type="promptRequest?.secret ? 'password' : 'text'" autocomplete="off" spellcheck="false" />
      <div class="actions">
        <button type="button" @click="finish(null)">Abbrechen</button>
        <button type="submit" class="primary" :disabled="promptRequest?.secret ? !value : !value.trim()">{{ promptRequest?.okLabel }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
dialog {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  color: var(--text);
  padding: 16px;
  width: min(420px, calc(100vw - 32px));
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
}
dialog::backdrop { background: rgb(0 0 0 / 0.35); }
form { display: flex; flex-direction: column; gap: 10px; }
label { font-weight: 600; }
input {
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
input:focus { outline: none; border-color: var(--accent); }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.primary:disabled { opacity: 0.45; }
</style>
