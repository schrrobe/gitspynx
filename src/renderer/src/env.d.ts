import type { GitspynxApi } from '../../shared/types'

declare global {
  interface Window {
    gitspynx: GitspynxApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
