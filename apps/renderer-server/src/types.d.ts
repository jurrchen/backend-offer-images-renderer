// Type declarations for modules without types

declare module 'gl' {
  function createContext(
    width: number,
    height: number,
    options?: {
      alpha?: boolean
      depth?: boolean
      stencil?: boolean
      antialias?: boolean
      premultipliedAlpha?: boolean
      preserveDrawingBuffer?: boolean
    }
  ): WebGLRenderingContext
  export = createContext
}
