export interface DesignerOutputConfig {
  width?: number
  height?: number
  imageFormat?: 'png' | 'jpeg'
  imageQuality?: number
  scaleMode?: 'contain' | 'cover' | 'natural'
  backgroundColor?: string
}

export interface DesignerCenteringResult {
  assetId: string
  originalWidth: number
  originalHeight: number
  scaledWidth: number
  scaledHeight: number
  x: number
  y: number
  fitScale: number
}

export interface DesignerResult {
  regionId: string
  regionDimensions: { pixelsWidth: number; pixelsHeight: number }
  artworks: DesignerCenteringResult[]
  xastState: unknown
  previewImage: string
  outputConfig: Required<DesignerOutputConfig>
  duration: number
}
