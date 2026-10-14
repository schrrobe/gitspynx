import type { GitspynxBridge } from '../../shared/types'

declare global {
  interface Window {
    gitspynx: GitspynxBridge
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
