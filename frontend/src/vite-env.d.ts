/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHOW_PLANNED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
