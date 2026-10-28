/// <reference types="vite/client" />

declare module '*?inline' {
  const src: string
  export default src
}

declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
