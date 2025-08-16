/// <reference types="vite/client" />

declare const __WS_URL__: string;

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string
  readonly VITE_GEMINI_MODEL?: string
  readonly VITE_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}